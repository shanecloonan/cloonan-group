"""L4+ built-in defensive fuzz layer (Foundry + Echidna).

Copies the packaged conservation harness (vault / staking / lending) into
the work dir and runs `forge test --fuzz-runs N` / `echidna` when those
binaries are on PATH. Missing tools skip with a receipt note — never a
hard fail. No attacker contracts, no payload generation.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from eth_scanner.research.types import Finding, LayerSkip

_PKG_FUZZ = Path(__file__).resolve().parents[3] / "research" / "fuzz"

_FORGE_PASS = re.compile(r"\[PASS\]\s+(\S+)")
_FORGE_FAIL = re.compile(r"\[FAIL[^\]]*\]\s+(\S+)")
_FORGE_SUITE = re.compile(
    r"Suite result:\s+(ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed",
    re.I,
)
_ECHIDNA_PASS = re.compile(
    r"(?:echidna_\w+|Property\s+\S+).{0,40}(?:passed|passing)",
    re.I,
)
_ECHIDNA_FAIL = re.compile(
    r"(?:echidna_\w+|Property\s+\S+).{0,40}(?:failed|falsified)",
    re.I,
)

ECHIDNA_CONTRACTS = (
    "VaultProperties",
    "StakingProperties",
    "LendingProperties",
)


def packaged_fuzz_dir() -> Path:
    return _PKG_FUZZ


def forge_available() -> bool:
    return bool(shutil.which("forge"))


def echidna_available() -> bool:
    return bool(shutil.which("echidna"))


def materialize_fuzz_project(dest_dir: Path) -> Path:
    """Copy the packaged harness into dest_dir. Overwrites dest if present."""
    src = _PKG_FUZZ
    dest = Path(dest_dir)
    if not (src / "foundry.toml").is_file():
        raise FileNotFoundError("packaged fuzz harness missing foundry.toml under %s" % src)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("out", "cache", ".git"))
    return dest


def _tail(text: str, n: int = 12) -> str:
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    return " | ".join(ln.strip()[:160] for ln in lines[-n:])


def parse_forge_output(text: str) -> dict[str, object]:
    passed = _FORGE_PASS.findall(text or "")
    failed = _FORGE_FAIL.findall(text or "")
    suite = _FORGE_SUITE.search(text or "")
    return {
        "passed": passed,
        "failed": failed,
        "suite_ok": None if suite is None else suite.group(1).lower() == "ok",
        "passed_n": int(suite.group(2)) if suite else len(passed),
        "failed_n": int(suite.group(3)) if suite else len(failed),
    }


def parse_echidna_output(text: str) -> dict[str, object]:
    passed = _ECHIDNA_PASS.findall(text or "")
    failed = _ECHIDNA_FAIL.findall(text or "")
    return {
        "passed_n": len(passed),
        "failed_n": len(failed),
        "failed": failed,
        "ok": len(failed) == 0,
    }


def run_forge_fuzz(
    project_dir: Path,
    *,
    fuzz_runs: int = 64,
    timeout_s: int = 180,
) -> tuple[Optional[int], str, dict[str, object]]:
    """Run `forge test --fuzz-runs N`. Returns (rc, note, parsed)."""
    parsed: dict[str, object] = {"passed": [], "failed": [], "passed_n": 0, "failed_n": 0, "suite_ok": None}
    if not forge_available():
        return None, "forge not on PATH — L4 fuzz skipped (harness still written)", parsed
    root = Path(project_dir)
    if not (root / "foundry.toml").is_file():
        return None, "no foundry.toml under %s — L4 fuzz skipped" % root, parsed
    runs = max(1, min(int(fuzz_runs or 64), 256))
    try:
        proc = subprocess.run(
            ["forge", "test", "--fuzz-runs", str(runs), "--invariant-runs", "8"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None, "forge test timed out after %ss" % timeout_s, parsed
    except OSError as exc:
        return None, "forge failed to start: %s" % exc, parsed
    blob = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    parsed = parse_forge_output(blob)
    note = "forge test --fuzz-runs %s exit=%s passed=%s failed=%s" % (
        runs, proc.returncode, parsed["passed_n"], parsed["failed_n"],
    )
    tail = _tail(blob, 4)
    if tail:
        note += " — " + tail[:240]
    return proc.returncode, note, parsed


def run_echidna(
    project_dir: Path,
    *,
    timeout_s: int = 90,
) -> tuple[Optional[int], str, dict[str, object]]:
    """Run Echidna property campaigns when the CLI is present."""
    parsed: dict[str, object] = {"passed_n": 0, "failed_n": 0, "failed": [], "ok": True}
    if not echidna_available():
        return None, "echidna not on PATH — L4 echidna skipped", parsed
    root = Path(project_dir)
    cfg = root / "echidna.yaml"
    notes: list[str] = []
    worst_rc: Optional[int] = 0
    any_ran = False
    for name in ECHIDNA_CONTRACTS:
        sol = root / "echidna" / ("%s.sol" % name)
        if not sol.is_file():
            continue
        cmd = ["echidna", str(sol), "--contract", name]
        if cfg.is_file():
            cmd.extend(["--config", str(cfg)])
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired:
            notes.append("%s timed out after %ss" % (name, timeout_s))
            worst_rc = None
            continue
        except OSError as exc:
            notes.append("%s failed to start: %s" % (name, exc))
            worst_rc = None
            continue
        any_ran = True
        blob = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        one = parse_echidna_output(blob)
        parsed["passed_n"] = int(parsed["passed_n"]) + int(one["passed_n"])
        parsed["failed_n"] = int(parsed["failed_n"]) + int(one["failed_n"])
        parsed["failed"] = list(parsed["failed"]) + list(one["failed"])  # type: ignore[arg-type]
        if proc.returncode not in (0, None) and worst_rc is not None:
            worst_rc = proc.returncode
        notes.append("%s exit=%s" % (name, proc.returncode))
    if not any_ran and worst_rc is not None and not notes:
        return None, "echidna property contracts missing — skipped", parsed
    parsed["ok"] = int(parsed["failed_n"]) == 0
    note = "echidna " + "; ".join(notes) if notes else "echidna ran"
    note += " passed=%s failed=%s" % (parsed["passed_n"], parsed["failed_n"])
    return worst_rc, note, parsed


def run_fuzz_layer(
    *,
    address: str,
    dest_dir: Path,
    fuzz_runs: int = 64,
    try_forge: bool = True,
    try_echidna: bool = True,
) -> tuple[list[Finding], list[LayerSkip], list[str], Optional[Path]]:
    """Materialize the harness and run optional CLIs. Always returns findings."""
    findings: list[Finding] = []
    skips: list[LayerSkip] = []
    notes: list[str] = []
    try:
        project = materialize_fuzz_project(dest_dir)
    except (OSError, FileNotFoundError) as exc:
        skips.append(LayerSkip(layer="L4", reason="fuzz harness copy failed: %s" % exc))
        return findings, skips, notes, None

    notes.append("L4 fuzz harness written to %s" % project)
    findings.append(Finding(
        id="L4-fuzz-harness-1",
        severity="info",
        layer="L4",
        title="Defensive fuzz harness materialized",
        evidence="vault conservation + share/asset + staking balance + lending solvency under %s" % project,
        address=address,
        detector="fuzz:harness",
    ))

    if try_forge:
        rc, forge_note, parsed = run_forge_fuzz(project, fuzz_runs=fuzz_runs)
        notes.append(forge_note)
        skipped = rc is None
        failed_n = int(parsed.get("failed_n") or 0)
        if skipped:
            findings.append(Finding(
                id="L4-fuzz-forge-1",
                severity="info",
                layer="L4",
                title="Foundry fuzz skipped",
                evidence=forge_note,
                address=address,
                detector="fuzz:forge",
            ))
            skips.append(LayerSkip(layer="L4", reason=forge_note))
        else:
            sev = "high" if failed_n else "info"
            title = (
                "Foundry fuzz property failure"
                if failed_n else
                "Foundry fuzz properties held"
            )
            extra = ""
            failed = parsed.get("failed") or []
            if failed:
                extra = " failed=" + ",".join(str(x) for x in failed[:8])
            findings.append(Finding(
                id="L4-fuzz-forge-1",
                severity=sev,  # type: ignore[arg-type]
                layer="L4",
                title=title,
                evidence=forge_note + extra,
                address=address,
                detector="fuzz:forge",
            ))
    else:
        notes.append("forge fuzz disabled by flag")
        skips.append(LayerSkip(layer="L4", reason="forge fuzz disabled by flag"))

    if try_echidna:
        rc, echi_note, eparsed = run_echidna(project)
        notes.append(echi_note)
        skipped = rc is None and "not on PATH" in echi_note
        failed_n = int(eparsed.get("failed_n") or 0)
        if skipped or rc is None:
            findings.append(Finding(
                id="L4-fuzz-echidna-1",
                severity="info",
                layer="L4",
                title="Echidna campaign skipped",
                evidence=echi_note,
                address=address,
                detector="fuzz:echidna",
            ))
            skips.append(LayerSkip(layer="L4", reason=echi_note))
        else:
            sev = "high" if failed_n else "info"
            findings.append(Finding(
                id="L4-fuzz-echidna-1",
                severity=sev,  # type: ignore[arg-type]
                layer="L4",
                title="Echidna properties failed" if failed_n else "Echidna properties held",
                evidence=echi_note,
                address=address,
                detector="fuzz:echidna",
            ))
    else:
        notes.append("echidna disabled by flag")

    return findings, skips, notes, project
