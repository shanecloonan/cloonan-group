"""L2 custom Python detectors — defensive shape checks only.

1. External value/token movers gated by weak / missing auth.
2. Share / asset accounting surface on vault-like contracts.
3. Oracle freshness hooks when Chainlink-like interfaces are present.

No path synthesis. No exploit sketches.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from eth_scanner.heuristics.invariant_pass import functions, solidity_modifiers, strip_comments
from eth_scanner.research.types import Finding
from eth_scanner.types import FunctionIR, IRDocument

_VALUE_MOVE = re.compile(
    r"\.transferFrom\s*\(|\.transfer\s*\(|safeTransfer(From)?\s*\(|"
    r"\.call\s*\{\s*value|\.send\s*\(|payable\s*\([^)]+\)\s*\.transfer",
    re.I,
)
_SHARE_TERMS = re.compile(
    r"\b(totalAssets|totalSupply|convertToShares|convertToAssets|"
    r"pricePerShare|previewDeposit|previewRedeem|balanceOf)\b",
)
_SHARE_BURN = re.compile(r"_burn\s*\(|balanceOf\s*\[|totalSupply\s*\-", re.I)
_ORACLE_IFACE = re.compile(
    r"\b(latestRoundData|latestAnswer|AggregatorV3Interface|aggregator)\b",
)
_ORACLE_FRESH = re.compile(
    r"\b(updatedAt|startedAt|stale|heartbeat|maxDelay|maxAge|answeredInRound)\b",
    re.I,
)
_WEAK = frozenset({"WEAK", "MISSING", "MISSING(internal — check callers)", "AMBIGUOUS"})


def _finding(
    *,
    n: int,
    detector: str,
    severity: str,
    title: str,
    evidence: str,
    address: str,
) -> Finding:
    return Finding(
        id="L2-%s-%d" % (detector, n),
        severity=severity,  # type: ignore[arg-type]
        layer="L2",
        title=title,
        evidence=evidence,
        address=address,
        detector="custom:%s" % detector,
    )


def detect_weak_auth_value_moves(
    *,
    address: str,
    source: str,
    lane_ir: Optional[IRDocument] = None,
) -> list[Finding]:
    findings: list[Finding] = []
    if lane_ir and lane_ir.functions:
        movers: Iterable[FunctionIR] = [
            fn for fn in lane_ir.functions
            if fn.is_value_mover and fn.exposed and fn.role not in {"erc20-standard", "wrap-unwrap"}
        ]
        n = 0
        for fn in movers:
            auth = fn.auth_heuristic or "AMBIGUOUS"
            if auth not in _WEAK and auth != "MISSING":
                continue
            n += 1
            sev = "high" if auth.startswith("MISSING") else "low"
            findings.append(_finding(
                n=n,
                detector="weak-auth-value-move",
                severity=sev,
                title="Value-moving function with %s auth heuristic" % auth,
                evidence="%s %s L%d role=%s auth=%s signals=%s"
                % (fn.visibility, fn.name, fn.line, fn.role, auth, ",".join(fn.fund_signals[:6]) or "—"),
                address=address,
            ))
        return findings

    clean = strip_comments(source or "", "solidity")
    mods = solidity_modifiers(clean)
    n = 0
    for fn in functions(source or "", clean, "solidity"):
        vis = fn.get("vis") or ""
        if "external" not in vis and "public" not in vis:
            continue
        if "view" in vis or "pure" in vis:
            continue
        body = fn.get("body") or ""
        if not _VALUE_MOVE.search(body):
            continue
        header = fn.get("header") or ""
        gated = bool(re.search(r"\bonly[A-Z]\w+", header)) or bool(
            re.search(r"\b(onlyOwner|onlyRole|requiresAuth|auth)\b", header)
        )
        if not gated:
            for mname in mods:
                if re.search(r"\b%s\b" % re.escape(mname), header):
                    gated = True
                    break
        if gated:
            continue
        n += 1
        findings.append(_finding(
            n=n,
            detector="weak-auth-value-move",
            severity="high",
            title="External value move without an auth modifier",
            evidence="%s %s L%d — transfer/call{value} with no only* modifier"
            % (vis, fn.get("name"), fn.get("line") or 0),
            address=address,
        ))
    return findings


def detect_share_asset_shape(
    *,
    address: str,
    source: str,
    role: str = "",
) -> list[Finding]:
    if role not in {"vault", "staking", "lending"}:
        return []
    src = source or ""
    findings: list[Finding] = []
    has_deposit = bool(re.search(r"\bfunction\s+(deposit|mint|stake|supply)\b", src))
    has_withdraw = bool(re.search(r"\bfunction\s+(withdraw|redeem|unstake)\b", src))
    terms = sorted(set(m.group(0) for m in _SHARE_TERMS.finditer(src)))
    if (has_deposit or has_withdraw) and not terms:
        findings.append(_finding(
            n=1,
            detector="share-asset-shape",
            severity="low",
            title="Deposit/withdraw without share/asset accounting terms",
            evidence="role=%s deposit=%s withdraw=%s — no totalAssets/totalSupply/convertTo* / pricePerShare"
            % (role, has_deposit, has_withdraw),
            address=address,
        ))
        return findings
    if has_withdraw and not _SHARE_BURN.search(src) and role == "vault":
        findings.append(_finding(
            n=1,
            detector="share-asset-shape",
            severity="low",
            title="Withdraw without an obvious share-burn / balance decrement",
            evidence="role=vault withdraw present; no `_burn` or `balanceOf[` decrement nearby (shape only)",
            address=address,
        ))
    if has_deposit and has_withdraw and terms:
        findings.append(_finding(
            n=len(findings) + 1,
            detector="share-asset-shape",
            severity="info",
            title="Share/asset accounting terms present",
            evidence="role=%s terms=%s" % (role, ",".join(terms[:12])),
            address=address,
        ))
    return findings


def detect_oracle_freshness(*, address: str, source: str) -> list[Finding]:
    src = source or ""
    if not _ORACLE_IFACE.search(src):
        return []
    if _ORACLE_FRESH.search(src):
        return [Finding(
            id="L2-oracle-freshness-1",
            severity="info",
            layer="L2",
            title="Chainlink-like feed with a freshness hook term",
            evidence="latestRoundData/latestAnswer present alongside updatedAt/stale/heartbeat (confirm by reading)",
            address=address,
            detector="custom:oracle-freshness",
        )]
    return [Finding(
        id="L2-oracle-freshness-1",
        severity="med",
        layer="L2",
        title="Chainlink-like feed without an obvious freshness check",
        evidence=(
            "Aggregator / latestRoundData / latestAnswer appears in source; "
            "no updatedAt / stale / heartbeat / answeredInRound term. Shape only — not a path."
        ),
        address=address,
        detector="custom:oracle-freshness",
    )]


def run_custom_detectors(
    *,
    address: str,
    source: str,
    role: str = "",
    lane_ir: Optional[IRDocument] = None,
) -> list[Finding]:
    out: list[Finding] = []
    out.extend(detect_weak_auth_value_moves(address=address, source=source, lane_ir=lane_ir))
    out.extend(detect_share_asset_shape(address=address, source=source, role=role))
    out.extend(detect_oracle_freshness(address=address, source=source))
    return out
