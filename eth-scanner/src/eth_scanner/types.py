"""Shared types for the Ethereum-only invariant scanner.

Automation emits *buckets*, never a human verdict. Heuristic flags are
leads, never findings. See docs/ETH_SWEEP_SCANNING_REFERENCE.md §6.0.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Literal, Optional

Chain = Literal["ethereum"]
SrcConfidence = Literal["high", "med", "low"]
IrConfidence = Literal["high", "med", "low"]
Bucket = Literal[
    "lane-a-cool",
    "lane-b-queue",
    "manual-review",
    "human-no-candidate",
    "human-yes-candidate",
]
TargetStatus = Literal["pending", "running", "done", "skipped", "error"]
ArtifactKind = Literal["source", "decompile", "ir", "report"]
HypothesisStatus = Literal["HOLDS", "BROKEN", "OPEN"]
AuthHeuristic = Literal[
    "PRESENT",
    "WEAK",
    "MISSING",
    "MISSING(internal — check callers)",
    "SELF-SCOPED?",
    "AMBIGUOUS",
]

BUCKETS: tuple[Bucket, ...] = (
    "lane-a-cool",
    "lane-b-queue",
    "manual-review",
    "human-no-candidate",
    "human-yes-candidate",
)

# §6.0 heat ranking only — never used to auto-dismiss.
DEFAULT_HEAT_THRESHOLD = 3
DEFAULT_TVL_FLOOR_USD = 10_000.0


def to_plain(obj: Any) -> Any:
    """JSON-friendly dump for dataclasses / lists / dicts."""
    if is_dataclass(obj) and not isinstance(obj, type):
        return {k: to_plain(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: to_plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_plain(v) for v in obj]
    return obj


@dataclass
class Target:
    address: str
    chain: Chain = "ethereum"
    bytecode_hash: Optional[str] = None
    bytecode: Optional[str] = None
    tvl_usd: Optional[float] = None
    status: TargetStatus = "pending"
    has_code: bool = True
    # Prior closed-no hashes for this exact bytecode (S0 dedupe).
    prior_closed_no: bool = False
    prior_verdict: Optional[str] = None


@dataclass
class SourceArtifact:
    """Verified source or decompile text. Decompile is never proof."""

    kind: ArtifactKind
    language: str  # solidity | vyper | unknown
    content: str
    src_confidence: SrcConfidence
    verified_match: Optional[str] = None  # exact | partial | none
    compiler: Optional[str] = None
    contract_name: Optional[str] = None
    is_proxy: bool = False
    implementation: Optional[str] = None
    tool: Optional[str] = None  # etherscan | heimdall | panoramix | local | none
    notes: list[str] = field(default_factory=list)


@dataclass
class FunctionIR:
    name: str
    visibility: str
    line: int
    end: int = 0
    file: str = ""
    modifiers: list[str] = field(default_factory=list)
    fund_signals: list[str] = field(default_factory=list)
    auth_signals: list[str] = field(default_factory=list)
    auth_heuristic: str = "AMBIGUOUS"
    accounting_touched: list[str] = field(default_factory=list)
    is_value_mover: bool = False
    exposed: bool = False


@dataclass
class IRDocument:
    functions: list[FunctionIR] = field(default_factory=list)
    ir_confidence: IrConfidence = "low"
    src_confidence: SrcConfidence = "low"
    language: str = "unknown"
    lift_failed: bool = False
    lift_tool: str = "heuristic"
    notes: list[str] = field(default_factory=list)
    surface: dict[str, Any] = field(default_factory=dict)
    weird_signals: list[str] = field(default_factory=list)
    pattern_leads: list[dict[str, Any]] = field(default_factory=list)
    accounting_hits: list[dict[str, Any]] = field(default_factory=list)
    external_calls: list[dict[str, Any]] = field(default_factory=list)
    abi_mismatch_hint: bool = False
    fork_family: Optional[str] = None


@dataclass
class StageTrace:
    stage: str
    decision: str
    reason: str
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class Hypothesis:
    invariant: str  # I1–I8
    text: str
    status: HypothesisStatus = "OPEN"
    score: int = 0
    axes: dict[str, int] = field(default_factory=dict)
    locus: Optional[str] = None  # file:function:line if known
    notes: str = ""


@dataclass
class FunnelResult:
    bucket: Optional[Bucket]
    dropped: bool
    drop_reason: Optional[str]
    heat: int
    src_confidence: SrcConfidence
    ir_confidence: IrConfidence
    stage_trace: list[StageTrace] = field(default_factory=list)
    pattern_leads: list[dict[str, Any]] = field(default_factory=list)
    hypotheses: list[Hypothesis] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    value_movers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_plain(self)
