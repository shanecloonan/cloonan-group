"""S0–S7 scoring funnel from SWEEP_SCANNING_REFERENCE §6.0.

Cheap stages first. Ambiguity never becomes discard — weak or failed
cheap checks route to `manual-review`, never automated `no` / `skip`.

Never auto-yes. Never auto-no on low IR / decompile confidence.
Heat ranks only; it does not dismiss.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from eth_scanner.heuristics.patterns import detect_fork_family, detect_weird_signals, skim_known_patterns
from eth_scanner.types import (
    DEFAULT_HEAT_THRESHOLD,
    DEFAULT_TVL_FLOOR_USD,
    Bucket,
    FunnelResult,
    Hypothesis,
    IRDocument,
    SourceArtifact,
    StageTrace,
    Target,
)


@dataclass
class FunnelConfig:
    heat_threshold: int = DEFAULT_HEAT_THRESHOLD
    tvl_floor_usd: float = DEFAULT_TVL_FLOOR_USD


@dataclass
class FunnelContext:
    target: Target
    artifact: Optional[SourceArtifact] = None
    ir: Optional[IRDocument] = None
    source_text: str = ""
    hypotheses: list[Hypothesis] = field(default_factory=list)
    config: FunnelConfig = field(default_factory=FunnelConfig)


def _trace(stage: str, decision: str, reason: str, **extras: Any) -> StageTrace:
    return StageTrace(stage=stage, decision=decision, reason=reason, extras=extras)


def _exposed_movers(ir: IRDocument) -> list[str]:
    names: list[str] = []
    for fn in ir.functions:
        if fn.is_value_mover and fn.exposed and fn.role != "erc20-standard":
            names.append(fn.name)
    return names


def _erc20_standard_names(ir: Optional[IRDocument]) -> list[str]:
    if ir is None:
        return []
    return [fn.name for fn in ir.functions if fn.role == "erc20-standard" and fn.exposed]


def _auth_for(ir: IRDocument, name: str) -> str:
    for fn in ir.functions:
        if fn.name == name:
            return fn.auth_heuristic
    return "AMBIGUOUS"


def run_lane_a(ctx: FunnelContext) -> FunnelResult:
    """S0–S6. Lane A emits a bucket; it never stamps yes/no."""
    notes: list[str] = [
        "Lane A is noise-kill + ranking, not a verdict.",
        "Do Not Auto-Dismiss: low/failed IR or ambiguous cheap checks → manual-review.",
    ]
    traces: list[StageTrace] = []
    src_conf = ctx.artifact.src_confidence if ctx.artifact else "low"
    ir = ctx.ir
    ir_conf = ir.ir_confidence if ir else "low"
    heat = 0
    pattern_leads: list[dict[str, Any]] = []

    # --- S0 Intake gate ----------------------------------------------------
    s0 = _stage_s0(ctx.target)
    traces.append(s0)
    if s0.decision == "drop":
        return FunnelResult(
            bucket=None,
            dropped=True,
            drop_reason=s0.reason,
            heat=0,
            src_confidence=src_conf,
            ir_confidence=ir_conf,
            stage_trace=traces,
            notes=notes + [s0.reason],
        )

    # --- S1 Artifact class -------------------------------------------------
    traces.append(_trace(
        "S1", "tag",
        "src_confidence=%s (never discard on low)" % src_conf,
        src_confidence=src_conf,
        kind=(ctx.artifact.kind if ctx.artifact else "missing"),
        verified_match=(ctx.artifact.verified_match if ctx.artifact else None),
    ))

    # --- S2 IR confidence --------------------------------------------------
    # Failed lift or low IR → manual-review. Low src (decompile) also
    # forces manual-review after S2 (heat override + S1 prefer-manual).
    if ir is None or ir.lift_failed or ir_conf == "low":
        reason = "ir_failed_or_low"
        traces.append(_trace("S2", "manual-review", reason, ir_confidence=ir_conf, lift_failed=bool(ir and ir.lift_failed)))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Do Not Auto-Dismiss: IR build failed or ir_confidence=low.",
            pattern_leads=pattern_leads,
            movers=_exposed_movers(ir) if ir else [],
        )
    if src_conf == "low":
        traces.append(_trace("S2", "manual-review", "src_confidence=low override", src_confidence=src_conf))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Do Not Auto-Dismiss: src_confidence=low (decompile / unverified) → manual-review.",
            pattern_leads=pattern_leads,
            movers=_exposed_movers(ir),
        )
    traces.append(_trace("S2", "continue", "ir_confidence=%s" % ir_conf, ir_confidence=ir_conf, lift_tool=ir.lift_tool))

    # --- S3 Known-pattern skim (high/med IR only) --------------------------
    source = ctx.source_text or (ctx.artifact.content if ctx.artifact else "")
    pattern_leads = list(ir.pattern_leads) or skim_known_patterns(source)
    traces.append(_trace(
        "S3", "leads-only",
        "pattern hits=%d (never a close)" % len(pattern_leads),
        lead_ids=[p.get("id") for p in pattern_leads],
    ))

    # --- S4 Value-mover presence -------------------------------------------
    movers = _exposed_movers(ir)
    erc20_leads = _erc20_standard_names(ir)
    erc20_note = ""
    if erc20_leads:
        erc20_note = (
            " ERC20-standard transfer/approve surfaces %s recorded as leads, "
            "not I1 custody movers." % ",".join(erc20_leads[:12])
        )
    if not movers:
        if ir_conf == "high" and src_conf == "high":
            traces.append(_trace(
                "S4", "human-no-candidate",
                "no custody movers + high IR + verified",
                erc20_standard=erc20_leads,
            ))
            traces.append(_trace("S5", "skip", "no custody movers"))
            traces.append(_trace("S6", "skip", "S4 closed as human-no-candidate (still needs human stamp)"))
            return _done(
                "human-no-candidate", traces, src_conf, ir_conf, heat, notes,
                extra="Candidate auto-no only: high IR + verified + no custody movers. Human still stamps no." + erc20_note,
                pattern_leads=pattern_leads,
            )
        traces.append(_trace(
            "S4", "lane-a-cool",
            "no custody movers; IR not high+verified so not a close",
            erc20_standard=erc20_leads,
        ))
        traces.append(_trace("S5", "skip", "no custody movers"))
        traces.append(_trace("S6", "lane-a-cool", "utility / non-custody / vanilla ERC20 with usable IR"))
        return _done(
            "lane-a-cool", traces, src_conf, ir_conf, heat, notes,
            extra="No exposed custody movers; absence is only a close when IR is high and source verified." + erc20_note,
            pattern_leads=pattern_leads,
        )
    traces.append(_trace("S4", "continue", "exposed value movers=%d" % len(movers), movers=movers))

    # --- S5 Cheap I1 auth heat ---------------------------------------------
    ambiguous = False
    missing_or_weak = False
    all_strong = True
    auth_map: dict[str, str] = {}
    for name in movers:
        auth = _auth_for(ir, name)
        auth_map[name] = auth
        if auth in ("AMBIGUOUS", "SELF-SCOPED?"):
            ambiguous = True
            all_strong = False
        elif auth.startswith("MISSING") or auth == "WEAK":
            missing_or_weak = True
            all_strong = False
            if ir_conf == "high":
                heat += 2
        elif auth != "PRESENT":
            ambiguous = True
            all_strong = False

    if ambiguous:
        traces.append(_trace("S5", "manual-review", "ambiguous cheap auth parse", auth=auth_map, heat=heat))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Ambiguous cheap I1 check → manual-review, never discard.",
            pattern_leads=pattern_leads,
            movers=movers,
        )

    if missing_or_weak:
        traces.append(_trace("S5", "heat+", "missing/weak bind on a value mover", auth=auth_map, heat=heat))
    elif all_strong and ir_conf == "high":
        traces.append(_trace("S5", "cool-candidate", "strong bind on all movers + high IR", auth=auth_map, heat=heat))
    else:
        traces.append(_trace("S5", "continue", "auth present or IR not high", auth=auth_map, heat=heat))

    # Additive heat (ranking only)
    weird = list(ir.weird_signals) or detect_weird_signals(source)
    fork = ir.fork_family or detect_fork_family(source)
    if "bridge-mint-release" in weird:
        heat += 2
    if ir.abi_mismatch_hint or (ctx.artifact and ctx.artifact.is_proxy and not ctx.artifact.implementation):
        heat += 2
        ir.abi_mismatch_hint = True
    unpaired_acct = bool(ir.accounting_hits) and not any(fn.accounting_touched for fn in ir.functions if fn.is_value_mover)
    if unpaired_acct:
        heat += 1
    if fork and any(s in weird for s in ("custom-share-math", "proxy-delegatecall", "first-deposit-edge")):
        heat += 1
    if "first-deposit-edge" in weird:
        heat += 1
    heat = min(heat, 12)

    # --- S6 Deep-lane gate -------------------------------------------------
    tvl = float(ctx.target.tvl_usd or 0)
    promote = (
        heat >= ctx.config.heat_threshold
        or tvl >= ctx.config.tvl_floor_usd
        or bool(set(weird) & {"bridge-mint-release", "custom-share-math", "proxy-delegatecall"})
        or bool(fork and missing_or_weak)
    )
    if promote:
        traces.append(_trace(
            "S6", "lane-b-queue",
            "heat/TVL/weirdness gate",
            heat=heat, tvl_usd=tvl, weird=weird, fork_family=fork,
            heat_threshold=ctx.config.heat_threshold, tvl_floor=ctx.config.tvl_floor_usd,
        ))
        return _done(
            "lane-b-queue", traces, src_conf, ir_conf, heat, notes,
            extra="Promoted to Lane B (deep invariants). Not a finding.",
            pattern_leads=pattern_leads,
            movers=movers,
        )

    traces.append(_trace(
        "S6", "lane-a-cool",
        "below deep-lane gate",
        heat=heat, tvl_usd=tvl, weird=weird,
    ))
    return _done(
        "lane-a-cool", traces, src_conf, ir_conf, heat, notes,
        extra="Lane A archive with score trail. Human spot-check sample.",
        pattern_leads=pattern_leads,
        movers=movers,
    )


def run_lane_b(ctx: FunnelContext) -> FunnelResult:
    """S7 deep invariants. Workers never invent BROKEN from heuristics.

    Routing is still implemented for an injected BROKEN hypothesis so a
    human-verified locus can land in `human-yes-candidate`. Automation
    itself only emits OPEN / HOLDS-shaped leads.
    """
    notes = [
        "Lane B is thoroughness on S6 survivors and manual-review promotions.",
        "Never auto-yes. BROKEN requires an exact locus and a human stamp.",
        "Heuristic flags remain leads, never findings.",
    ]
    traces = list(_prior_or_s7_header(ctx))
    src_conf = ctx.artifact.src_confidence if ctx.artifact else (ctx.ir.src_confidence if ctx.ir else "low")
    ir = ctx.ir
    ir_conf = ir.ir_confidence if ir else "low"
    heat = 0
    movers = _exposed_movers(ir) if ir else []

    if ir is None or ir.lift_failed or ir_conf == "low" or src_conf == "low":
        traces.append(_trace("S7", "manual-review", "low-confidence residual after promotion"))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Low IR/src residual → needs-look / manual-review. Not a silent no.",
            hypotheses=list(ctx.hypotheses),
            movers=movers,
        )

    hyps = list(ctx.hypotheses)
    if any(h.status == "BROKEN" for h in hyps):
        broken = [h for h in hyps if h.status == "BROKEN"]
        traces.append(_trace(
            "S7", "human-yes-candidate",
            "BROKEN hypothesis present — human must verify path (no PoC)",
            loci=[h.locus for h in broken],
        ))
        return _done(
            "human-yes-candidate", traces, src_conf, ir_conf, heat, notes,
            extra="Candidate only. Human stamps yes after path verify. Automation never emits verdict yes.",
            hypotheses=hyps,
            movers=movers,
        )

    open_high = [h for h in hyps if h.status == "OPEN" and h.score >= 8]
    if open_high:
        traces.append(_trace("S7", "manual-review", "OPEN hypothesis score>=8", scores=[h.score for h in open_high]))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="OPEN ≥8 → needs-look. Human six-pass / read.",
            hypotheses=hyps,
            movers=movers,
        )

    if hyps and all(h.status == "HOLDS" for h in hyps) and ir_conf == "high" and src_conf == "high":
        traces.append(_trace("S7", "human-no-candidate", "all HOLDS + high confidence"))
        return _done(
            "human-no-candidate", traces, src_conf, ir_conf, heat, notes,
            extra="High-confidence all-clear after S7. Human still stamps no.",
            hypotheses=hyps,
            movers=movers,
        )

    traces.append(_trace("S7", "manual-review", "residual OPEN or not all HOLDS at high confidence"))
    return _done(
        "manual-review", traces, src_conf, ir_conf, heat, notes,
        extra="Prefer a larger manual bucket over a false no.",
        hypotheses=hyps,
        movers=movers,
    )


def build_hypotheses(ir: IRDocument, tvl_usd: Optional[float] = None) -> list[Hypothesis]:
    """I1–I8 hypothesis stubs from surface IR. Status is OPEN (never BROKEN)."""
    funds_axis = _funds_axis(tvl_usd)
    hyps: list[Hypothesis] = []
    movers = [fn for fn in ir.functions if fn.is_value_mover and fn.exposed]
    for fn in movers:
        auth_axis = {"PRESENT": 0, "WEAK": 2, "SELF-SCOPED?": 2, "AMBIGUOUS": 2}.get(fn.auth_heuristic, 3)
        if fn.auth_heuristic.startswith("MISSING"):
            auth_axis = 3
        novelty = 2 if ir.fork_family else 1
        if ir.src_confidence == "low" or ir.abi_mismatch_hint:
            novelty = 3
        reach = 2
        score = min(12, funds_axis + reach + auth_axis + novelty)
        hyps.append(Hypothesis(
            invariant="I1",
            text="Value mover `%s` auth heuristic=%s (lead only)." % (fn.name, fn.auth_heuristic),
            status="OPEN",
            score=score,
            axes={"funds": funds_axis, "reachability": reach, "auth": auth_axis, "novelty": novelty},
            locus="%s:%s:%d" % (fn.file or "source", fn.name, fn.line),
            notes="Confirm beneficiary and debited account bind to the caller by reading. Not a finding.",
        ))
    if ir.accounting_hits:
        hyps.append(Hypothesis(
            invariant="I2",
            text="Accounting hotspot(s) present — check paired ledger updates.",
            status="OPEN",
            score=min(12, funds_axis + 1 + 1 + 1),
            axes={"funds": funds_axis, "reachability": 1, "auth": 1, "novelty": 1},
            notes="Heuristic surface only.",
        ))
    if ir.external_calls:
        hyps.append(Hypothesis(
            invariant="I3",
            text="External/low-level call sites — list trusted inputs by hand.",
            status="OPEN",
            score=min(12, funds_axis + 1 + 1 + 1),
            axes={"funds": funds_axis, "reachability": 1, "auth": 1, "novelty": 1},
        ))
    if ir.src_confidence == "low" or ir.abi_mismatch_hint:
        hyps.append(Hypothesis(
            invariant="I4",
            text="Source/decompile or proxy-implementation mismatch hint (I4).",
            status="OPEN",
            score=min(12, funds_axis + 2 + 2 + 3),
            axes={"funds": funds_axis, "reachability": 2, "auth": 2, "novelty": 3},
            notes="Deployed == reviewed is UNKNOWN until a human closes it.",
        ))
    if ir.fork_family:
        hyps.append(Hypothesis(
            invariant="I5",
            text="Fork-family hint `%s` — diff movers vs canonical by hand." % ir.fork_family,
            status="OPEN",
            score=min(12, funds_axis + 1 + 1 + 2),
            axes={"funds": funds_axis, "reachability": 1, "auth": 1, "novelty": 2},
        ))
    hyps.append(Hypothesis(
        invariant="I6",
        text="Privilege monotonicity: trace owner/role/upgrade writes (read-only).",
        status="OPEN",
        score=min(12, funds_axis + 1 + 1 + 1),
        axes={"funds": funds_axis, "reachability": 1, "auth": 1, "novelty": 1},
    ))
    if "first-deposit-edge" in ir.weird_signals:
        hyps.append(Hypothesis(
            invariant="I7",
            text="Empty-supply / first-deposit edge hint — reachable today?",
            status="OPEN",
            score=min(12, funds_axis + 2 + 2 + 2),
            axes={"funds": funds_axis, "reachability": 2, "auth": 2, "novelty": 2},
        ))
    if movers and ir.external_calls:
        hyps.append(Hypothesis(
            invariant="I8",
            text="Cross-function sequencing among value movers (describe in prose; do not script).",
            status="OPEN",
            score=min(12, funds_axis + 1 + 1 + 1),
            axes={"funds": funds_axis, "reachability": 1, "auth": 1, "novelty": 1},
        ))
    return hyps


def _funds_axis(tvl_usd: Optional[float]) -> int:
    if tvl_usd is None:
        return 1
    if tvl_usd <= 0:
        return 0
    if tvl_usd < 10_000:
        return 1
    if tvl_usd <= 1_000_000:
        return 2
    return 3


def _stage_s0(target: Target) -> StageTrace:
    if getattr(target, "chain", "ethereum") != "ethereum":
        return _trace("S0", "drop", "non-ethereum chain (this environment is Ethereum-only)", chain=target.chain)
    if not target.has_code:
        return _trace("S0", "drop", "empty EOA / zero-code", has_code=False, tvl_usd=target.tvl_usd)
    if target.prior_closed_no and target.bytecode_hash:
        return _trace(
            "S0", "drop",
            "exact duplicate bytecode already closed no",
            bytecode_hash=target.bytecode_hash,
        )
    if target.prior_verdict == "needs-look" and target.bytecode_hash:
        return _trace("S0", "keep", "duplicate-hash needs-look is not dropped", bytecode_hash=target.bytecode_hash)
    return _trace("S0", "keep", "intake ok", address=target.address, bytecode_hash=target.bytecode_hash)


def _prior_or_s7_header(ctx: FunnelContext) -> list[StageTrace]:
    return [_trace("S7", "start", "deep invariant pass (I1–I8 leads)", address=ctx.target.address)]


def _done(
    bucket: Bucket,
    traces: list[StageTrace],
    src_conf: str,
    ir_conf: str,
    heat: int,
    notes: list[str],
    extra: str = "",
    pattern_leads: Optional[list[dict[str, Any]]] = None,
    hypotheses: Optional[list[Hypothesis]] = None,
    movers: Optional[list[str]] = None,
) -> FunnelResult:
    n = list(notes)
    if extra:
        n.append(extra)
    return FunnelResult(
        bucket=bucket,
        dropped=False,
        drop_reason=None,
        heat=heat,
        src_confidence=src_conf,  # type: ignore[arg-type]
        ir_confidence=ir_conf,  # type: ignore[arg-type]
        stage_trace=traces,
        pattern_leads=pattern_leads or [],
        hypotheses=hypotheses or [],
        notes=n,
        value_movers=movers or [],
    )
