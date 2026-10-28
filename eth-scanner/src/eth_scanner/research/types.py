"""Research-stack types. Findings are defensive reports, never exploits."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from eth_scanner.types import to_plain

Severity = Literal["info", "low", "med", "high", "crit"]
Layer = Literal["L0", "L1", "L2", "L3", "L4", "L5"]

SEVERITIES: tuple[Severity, ...] = ("info", "low", "med", "high", "crit")
LAYERS: tuple[Layer, ...] = ("L0", "L1", "L2", "L3", "L4", "L5")


def _norm_severity(value: str) -> Severity:
    v = (value or "info").strip().lower()
    aliases = {"medium": "med", "critical": "crit", "informational": "info"}
    v = aliases.get(v, v)
    if v not in SEVERITIES:
        return "info"
    return v  # type: ignore[return-value]


def _norm_layer(value: str) -> Layer:
    v = (value or "L2").strip().upper()
    if v not in LAYERS:
        return "L2"
    return v  # type: ignore[return-value]


@dataclass
class Finding:
    """Defensive report row. `defensive_only` is always True."""

    id: str
    severity: Severity
    layer: Layer
    title: str
    evidence: str
    address: str
    detector: str
    defensive_only: bool = True

    def __post_init__(self) -> None:
        self.severity = _norm_severity(str(self.severity))
        self.layer = _norm_layer(str(self.layer))
        self.defensive_only = True
        self.id = str(self.id or "unknown")
        self.title = str(self.title or "")
        self.evidence = str(self.evidence or "")
        self.address = str(self.address or "")
        self.detector = str(self.detector or "")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "severity": self.severity,
            "layer": self.layer,
            "title": self.title,
            "evidence": self.evidence,
            "address": self.address,
            "detector": self.detector,
            "defensive_only": True,
        }


@dataclass
class SelectorEntry:
    name: str
    signature: str
    selector: str
    visibility: str = ""
    state_mutability: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)


@dataclass
class FacetEntry:
    address: str
    selectors: list[str] = field(default_factory=list)
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)


@dataclass
class ContractIR:
    """Normalized L0 contract IR for the research stack."""

    address: str
    name: str = ""
    role: str = "unknown"
    scope: str = "unknown"
    scope_signals: list[str] = field(default_factory=list)
    abi: list[dict[str, Any]] = field(default_factory=list)
    source_paths: list[str] = field(default_factory=list)
    storage_layout: Optional[dict[str, Any]] = None
    implementation: Optional[str] = None
    implementation_source: str = ""
    facets: list[FacetEntry] = field(default_factory=list)
    diamond_status: Optional[str] = None
    selectors: list[SelectorEntry] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    language: str = "solidity"
    compiler: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)


@dataclass
class FundsSink:
    name: str
    kind: str
    visibility: str
    gating: str
    modifiers: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)
    line: int = 0
    file: str = ""
    exposed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)


@dataclass
class AuthorityNode:
    name: str
    kind: str
    gated_functions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)


@dataclass
class FundsFlowGraph:
    """Callable sinks + gating. No exploit-path synthesis."""

    sinks: list[FundsSink] = field(default_factory=list)
    authorities: list[AuthorityNode] = field(default_factory=list)
    summary: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)


@dataclass
class LayerSkip:
    layer: Layer
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {"layer": self.layer, "reason": self.reason}


@dataclass
class ResearchRun:
    address: str
    gated: bool
    gate_reason: str
    role: str = "unknown"
    scope: str = "unknown"
    contract_ir: Optional[ContractIR] = None
    funds_flow: Optional[FundsFlowGraph] = None
    findings: list[Finding] = field(default_factory=list)
    layers_run: list[str] = field(default_factory=list)
    layers_skipped: list[LayerSkip] = field(default_factory=list)
    invariant_paths: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    receipt_md_path: Optional[str] = None
    receipt_json_path: Optional[str] = None
    lane_a_bucket: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "address": self.address,
            "gated": self.gated,
            "gate_reason": self.gate_reason,
            "role": self.role,
            "scope": self.scope,
            "lane_a_bucket": self.lane_a_bucket,
            "contract_ir": self.contract_ir.to_dict() if self.contract_ir else None,
            "funds_flow": self.funds_flow.to_dict() if self.funds_flow else None,
            "findings": [f.to_dict() for f in self.findings],
            "layers_run": list(self.layers_run),
            "layers_skipped": [s.to_dict() for s in self.layers_skipped],
            "invariant_paths": list(self.invariant_paths),
            "notes": list(self.notes),
            "receipt_md_path": self.receipt_md_path,
            "receipt_json_path": self.receipt_json_path,
            "defensive_only": True,
        }
