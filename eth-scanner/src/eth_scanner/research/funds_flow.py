"""L3 — funds-flow / authority graph.

From ABI + source (best effort): functions that transfer / call{value} /
ERC-20 transferFrom, plus the modifiers / roles that gate them.

Emits callable sinks + gating. Does not synthesize exploit paths.
"""

from __future__ import annotations

import re
from typing import Optional

from eth_scanner.heuristics.invariant_pass import functions, solidity_modifiers, strip_comments
from eth_scanner.research.types import AuthorityNode, Finding, FundsFlowGraph, FundsSink
from eth_scanner.types import IRDocument

_SINK_KIND = (
    (re.compile(r"\.call\s*\{\s*value", re.I), "call-value"),
    (re.compile(r"\.transferFrom\s*\(|safeTransferFrom\s*\(", re.I), "erc20-transferFrom"),
    (re.compile(r"safeTransfer\s*\(|\.transfer\s*\(", re.I), "erc20-or-eth-transfer"),
    (re.compile(r"\.send\s*\(", re.I), "send"),
    (re.compile(r"selfdestruct\s*\(|suicide\s*\(", re.I), "selfdestruct"),
)
_MOD_IN_HEADER = re.compile(r"\bonly[A-Z]\w+|\bauth\b|\brequiresAuth\b|\bonlyOwner\b|\bonlyRole\b")


def _sink_kind(body: str, name: str) -> Optional[str]:
    for rx, kind in _SINK_KIND:
        if rx.search(body or ""):
            return kind
    lname = (name or "").lower()
    if lname in {"withdraw", "redeem", "harvest", "sweep", "rescue", "claim"}:
        return "named-mover"
    return None


def _header_modifiers(header: str, known: dict[str, str]) -> list[str]:
    found: list[str] = []
    for mname in known:
        if re.search(r"\b%s\b" % re.escape(mname), header or ""):
            found.append(mname)
    for m in _MOD_IN_HEADER.finditer(header or ""):
        tok = m.group(0)
        if tok not in found:
            found.append(tok)
    return found


def build_funds_flow(
    *,
    source: str,
    lane_ir: Optional[IRDocument] = None,
    language: str = "solidity",
) -> FundsFlowGraph:
    notes = [
        "Authority graph lists callable sinks and their gating only.",
        "No path synthesis, no drain ordering, no attacker scheduling.",
    ]
    sinks: list[FundsSink] = []
    authorities: dict[str, AuthorityNode] = {}

    if lane_ir and lane_ir.functions:
        for fn in lane_ir.functions:
            if not fn.is_value_mover:
                continue
            if fn.role == "erc20-standard":
                continue
            kind = "custody" if fn.role in {"", "custody"} else fn.role
            mods = list(fn.modifiers) if fn.modifiers else []
            if fn.auth_signals:
                for sig in fn.auth_signals:
                    if sig.startswith("only") or sig in {"auth", "requiresAuth"}:
                        if sig not in mods:
                            mods.append(sig)
            sink = FundsSink(
                name=fn.name,
                kind=kind,
                visibility=fn.visibility,
                gating=fn.auth_heuristic or "AMBIGUOUS",
                modifiers=mods,
                signals=list(fn.fund_signals or []),
                line=fn.line,
                file=fn.file,
                exposed=fn.exposed,
            )
            sinks.append(sink)
            for mod in mods or (["_ungated"] if fn.auth_heuristic.startswith("MISSING") else []):
                node = authorities.setdefault(
                    mod, AuthorityNode(name=mod, kind="modifier" if mod != "_ungated" else "none"),
                )
                if fn.name not in node.gated_functions:
                    node.gated_functions.append(fn.name)
        if sinks:
            return _finish(sinks, authorities, notes)

    lang = language if language in {"solidity", "vyper"} else "solidity"
    clean = strip_comments(source or "", lang)
    mods = solidity_modifiers(clean) if lang == "solidity" else {}
    for fn in functions(source or "", clean, lang):
        body = fn.get("body") or ""
        name = fn.get("name") or "unknown"
        kind = _sink_kind(body, name)
        if not kind:
            continue
        header = fn.get("header") or ""
        vis = fn.get("vis") or ""
        exposed = "external" in vis or "public" in vis
        if "view" in vis or "pure" in vis:
            continue
        used = _header_modifiers(header, mods)
        gating = "PRESENT" if used else "MISSING"
        sinks.append(FundsSink(
            name=name,
            kind=kind,
            visibility=vis,
            gating=gating,
            modifiers=used,
            signals=[kind],
            line=int(fn.get("line") or 0),
            exposed=exposed,
        ))
        keys = used or (["_ungated"] if exposed else ["_internal"])
        for key in keys:
            node = authorities.setdefault(
                key,
                AuthorityNode(
                    name=key,
                    kind="modifier" if key not in {"_ungated", "_internal"} else "none",
                ),
            )
            if name not in node.gated_functions:
                node.gated_functions.append(name)
    return _finish(sinks, authorities, notes)


def _finish(
    sinks: list[FundsSink],
    authorities: dict[str, AuthorityNode],
    notes: list[str],
) -> FundsFlowGraph:
    exposed = [s for s in sinks if s.exposed]
    ungated = [s for s in exposed if s.gating.startswith("MISSING") or s.gating == "AMBIGUOUS"]
    summary = (
        "%d sink(s), %d exposed, %d exposed with MISSING/AMBIGUOUS gating, %d authority node(s)"
        % (len(sinks), len(exposed), len(ungated), len(authorities))
    )
    return FundsFlowGraph(
        sinks=sinks,
        authorities=list(authorities.values()),
        summary=summary,
        notes=notes,
    )


def funds_flow_findings(*, address: str, graph: FundsFlowGraph) -> list[Finding]:
    findings = [Finding(
        id="L3-authority-summary-1",
        severity="info",
        layer="L3",
        title="Funds-flow / authority summary",
        evidence=graph.summary,
        address=address,
        detector="funds-flow:summary",
    )]
    n = 0
    for sink in graph.sinks:
        if not sink.exposed:
            continue
        if not (
            sink.gating.startswith("MISSING")
            or sink.gating in {"AMBIGUOUS", "WEAK"}
        ):
            continue
        n += 1
        sev = "med" if sink.gating.startswith("MISSING") else "low"
        findings.append(Finding(
            id="L3-ungated-sink-%d" % n,
            severity=sev,  # type: ignore[arg-type]
            layer="L3",
            title="Exposed sink with %s gating" % sink.gating,
            evidence="%s %s kind=%s modifiers=%s"
            % (sink.visibility, sink.name, sink.kind, ",".join(sink.modifiers) or "—"),
            address=address,
            detector="funds-flow:ungated-sink",
        ))
    return findings
