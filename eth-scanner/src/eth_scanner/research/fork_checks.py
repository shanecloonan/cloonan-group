"""L5 — live fork consistency checks (scaffold).

Read-only `eth_call` against ETH_RPC_URL when set. Never sends a
transaction, never invents keys. Without RPC, dry-run / mock only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Callable, Optional

from eth_scanner.research.keccak import selector4
from eth_scanner.research.types import Finding, LayerSkip

RpcCall = Callable[[str, str, str], str]


def _eth_call(rpc_url: str, address: str, data: str, timeout_s: float = 15.0) -> str:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": address, "data": data}, "latest"],
    }).encode("utf-8")
    req = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "eth-scanner-research/0.1 (defensive; read-only)"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode("utf-8", errors="replace"))
    if body.get("error"):
        raise RuntimeError(str(body["error"]))
    return str(body.get("result") or "")


def decode_uint256(word: str) -> Optional[int]:
    raw = (word or "").strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    if not raw:
        return None
    try:
        return int(raw, 16)
    except ValueError:
        return None


def view_selector(signature: str) -> str:
    return selector4(signature)


class TotalAssetsCheck:
    """balance-vs-share / totalAssets consistency interface (scaffold)."""

    name = "total-assets-consistency"

    def __init__(self, slack: int = 1):
        self.slack = slack

    def run(
        self,
        address: str,
        *,
        rpc_url: str = "",
        eth_call: Optional[RpcCall] = None,
        mock: Optional[dict[str, int]] = None,
    ) -> tuple[Optional[Finding], Optional[LayerSkip], list[str]]:
        notes: list[str] = []
        if mock is not None:
            assets = int(mock.get("totalAssets") or 0)
            supply_as_assets = int(mock.get("convertToAssets_totalSupply") or 0)
            notes.append("L5 mock path (no RPC)")
            return self._compare(address, assets, supply_as_assets, notes)

        caller = eth_call
        if caller is None:
            if not rpc_url:
                return (
                    Finding(
                        id="L5-fork-skipped-1",
                        severity="info",
                        layer="L5",
                        title="Fork check skipped — no ETH_RPC_URL",
                        evidence="Set ETH_RPC_URL for a read-only totalAssets vs convertToAssets(totalSupply) check. No keys invented.",
                        address=address,
                        detector="fork:skipped",
                    ),
                    LayerSkip(layer="L5", reason="ETH_RPC_URL unset — dry-run/mock only"),
                    notes,
                )

            def caller(addr: str, data: str, _rpc: str = rpc_url) -> str:
                return _eth_call(_rpc, addr, data)

        try:
            assets_w = caller(address, view_selector("totalAssets()"))
            supply_w = caller(address, view_selector("totalSupply()"))
            # convertToAssets(uint256) — pass totalSupply as the arg
            supply = decode_uint256(supply_w)
            if supply is None:
                raise RuntimeError("totalSupply() did not return a uint256")
            data = view_selector("convertToAssets(uint256)") + ("%064x" % supply)
            claim_w = caller(address, data)
        except (OSError, TimeoutError, RuntimeError, urllib.error.URLError, ValueError) as exc:
            return (
                Finding(
                    id="L5-fork-error-1",
                    severity="info",
                    layer="L5",
                    title="Fork check could not complete",
                    evidence="read-only eth_call failed: %s" % exc,
                    address=address,
                    detector="fork:error",
                ),
                LayerSkip(layer="L5", reason="eth_call failed: %s" % exc),
                notes,
            )
        assets = decode_uint256(assets_w)
        claim = decode_uint256(claim_w)
        if assets is None or claim is None:
            return (
                None,
                LayerSkip(layer="L5", reason="could not decode totalAssets / convertToAssets"),
                notes,
            )
        notes.append("L5 read-only eth_call of totalAssets + convertToAssets(totalSupply)")
        return self._compare(address, assets, claim, notes)

    def _compare(
        self,
        address: str,
        assets: int,
        claim: int,
        notes: list[str],
    ) -> tuple[Finding, Optional[LayerSkip], list[str]]:
        ok = claim <= assets + self.slack
        sev = "info" if ok else "high"
        title = (
            "totalAssets covers convertToAssets(totalSupply)"
            if ok else
            "convertToAssets(totalSupply) exceeds totalAssets (property failure)"
        )
        return (
            Finding(
                id="L5-total-assets-1",
                severity=sev,  # type: ignore[arg-type]
                layer="L5",
                title=title,
                evidence="totalAssets=%s convertToAssets(totalSupply)=%s slack=%s"
                % (assets, claim, self.slack),
                address=address,
                detector="fork:total-assets",
            ),
            None,
            notes,
        )


def run_fork_checks(
    *,
    address: str,
    role: str = "",
    rpc_url: str = "",
    eth_call: Optional[RpcCall] = None,
    mock: Optional[dict[str, int]] = None,
) -> tuple[list[Finding], list[LayerSkip], list[str]]:
    findings: list[Finding] = []
    skips: list[LayerSkip] = []
    notes: list[str] = []
    if role not in {"vault", "staking", "lending"} and mock is None and not rpc_url:
        skips.append(LayerSkip(
            layer="L5",
            reason="role %s has no L5 consistency sketch; no RPC/mock" % (role or "unknown"),
        ))
        return findings, skips, notes
    finding, skip, extra = TotalAssetsCheck().run(
        address, rpc_url=rpc_url, eth_call=eth_call, mock=mock,
    )
    notes.extend(extra)
    if finding:
        findings.append(finding)
    if skip:
        skips.append(skip)
    return findings, skips, notes
