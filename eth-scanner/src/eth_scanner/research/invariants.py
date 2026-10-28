"""L4 — Foundry-style invariant *templates* for vault / staking / lending.

Generates conservation / solvency stubs. Never writes attacker contracts
or drain scripts. `forge test` runs only when a Foundry fixture exists
and `forge` is on PATH; otherwise skip with a note.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Optional

from eth_scanner.research.types import Finding, LayerSkip

ROLES_WITH_TEMPLATES = frozenset({"vault", "staking", "lending"})

_PKG_TEMPLATES = Path(__file__).resolve().parents[3] / "research" / "invariants" / "templates"

_EMBEDDED: dict[str, str] = {
    "vault": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Defensive invariant stubs — conservation / solvency. Not an attacker harness.
/// Do not add attacker or fund-moving tests here. Wire `vault` in setUp() against a
/// local fixture or a read-only fork.
interface IVaultLike {
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
}

contract VaultInvariants {
    IVaultLike internal vault;

    /// Share claim must not exceed assets (1 wei slack for rounding).
    function test_template_share_solvency() public view {
        uint256 supply = vault.totalSupply();
        uint256 assets = vault.totalAssets();
        assert(vault.convertToAssets(supply) <= assets + 1);
    }

    /// convertToShares(totalAssets) should not invent free shares (1 wei slack).
    function test_template_no_free_mint_shape() public view {
        uint256 assets = vault.totalAssets();
        uint256 supply = vault.totalSupply();
        assert(vault.convertToShares(assets) <= supply + 1);
    }

    /// totalAssets is a uint — this is a hook for L5 fork consistency.
    function test_template_assets_readable() public view {
        vault.totalAssets();
        vault.totalSupply();
    }
}
""",
    "staking": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Defensive staking stubs. Conservation inequalities only — no unstake attacks.
interface IStakingLike {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract StakingInvariants {
    IStakingLike internal staking;
    address internal probe;

    function test_template_stake_nonnegative() public view {
        staking.totalSupply();
        if (probe != address(0)) {
            staking.balanceOf(probe);
        }
    }

    /// A single account's stake cannot exceed total staked shares.
    function test_template_account_lte_total() public view {
        if (probe == address(0)) return;
        assert(staking.balanceOf(probe) <= staking.totalSupply());
    }
}
""",
    "lending": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Defensive lending stubs. Solvency inequalities only — no liquidation bots.
interface ILendingLike {
    function totalSupply() external view returns (uint256);
    function totalBorrows() external view returns (uint256);
    function totalReserves() external view returns (uint256);
    function getCash() external view returns (uint256);
}

contract LendingInvariants {
    ILendingLike internal market;

    /// Cash + borrows should cover supply minus reserves, with slack.
    /// Implementations differ; treat as a shape to instantiate, not a verdict.
    function test_template_cash_plus_borrows() public view {
        uint256 cash = market.getCash();
        uint256 borrows = market.totalBorrows();
        uint256 supply = market.totalSupply();
        uint256 reserves = market.totalReserves();
        assert(cash + borrows + 1 >= supply);
        reserves;
    }

    function test_template_borrows_readable() public view {
        market.totalBorrows();
        market.totalSupply();
    }
}
""",
}

_FILE_FOR_ROLE = {
    "vault": "VaultInvariants.t.sol",
    "staking": "StakingInvariants.t.sol",
    "lending": "LendingInvariants.t.sol",
}


def template_dir() -> Path:
    return _PKG_TEMPLATES


def load_template(role: str) -> str:
    role = (role or "").strip().lower()
    if role not in ROLES_WITH_TEMPLATES:
        raise ValueError("no invariant template for role %r" % role)
    path = _PKG_TEMPLATES / _FILE_FOR_ROLE[role]
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return _EMBEDDED[role]


def generate_invariant_stubs(
    role: str,
    dest_dir: Path,
    *,
    address: str = "",
) -> list[Path]:
    """Write Foundry-style stubs for a supported role. Empty list if skipped."""
    role = (role or "").strip().lower()
    if role not in ROLES_WITH_TEMPLATES:
        return []
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    body = load_template(role)
    if address:
        header = (
            "// Generated for %s (read-only template). Defensive only.\n"
            % address
        )
        if not body.startswith(header):
            body = header + body
    path = dest / _FILE_FOR_ROLE[role]
    path.write_text(body, encoding="utf-8")
    return [path]


def forge_available() -> bool:
    return bool(shutil.which("forge"))


def is_foundry_project(path: Path) -> bool:
    root = Path(path)
    if root.is_file():
        root = root.parent
    return (root / "foundry.toml").is_file()


def run_forge_test(
    project_dir: Path,
    *,
    timeout_s: int = 120,
) -> tuple[Optional[int], str]:
    """Run `forge test` when Foundry is installed. Returns (rc, note)."""
    if not forge_available():
        return None, "forge not on PATH — L4 runner skipped (template generation still ran)"
    if not is_foundry_project(project_dir):
        return None, "no foundry.toml under %s — L4 runner skipped" % project_dir
    try:
        proc = subprocess.run(
            ["forge", "test"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None, "forge test timed out after %ss" % timeout_s
    except OSError as exc:
        return None, "forge failed to start: %s" % exc
    note = "forge test exit=%s" % proc.returncode
    tail = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip().splitlines()
    if tail:
        note += " — " + tail[-1][:200]
    return proc.returncode, note


def invariant_findings(
    *,
    address: str,
    role: str,
    paths: list[Path],
    forge_note: str = "",
) -> tuple[list[Finding], Optional[LayerSkip]]:
    findings: list[Finding] = []
    skip: Optional[LayerSkip] = None
    if not paths:
        skip = LayerSkip(layer="L4", reason="role %s has no invariant template" % (role or "unknown"))
        return findings, skip
    findings.append(Finding(
        id="L4-template-1",
        severity="info",
        layer="L4",
        title="Foundry invariant stubs generated",
        evidence="%s → %s" % (role, ", ".join(str(p) for p in paths)),
        address=address,
        detector="invariants:template",
    ))
    if forge_note:
        skipped = "skipped" in forge_note or "not on PATH" in forge_note or "no foundry.toml" in forge_note
        findings.append(Finding(
            id="L4-forge-1",
            severity="info",
            layer="L4",
            title="Foundry runner %s" % ("skipped" if skipped else "ran"),
            evidence=forge_note,
            address=address,
            detector="invariants:forge",
        ))
        if skipped:
            skip = LayerSkip(layer="L4", reason=forge_note)
    return findings, skip
