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
from eth_scanner.heuristics.scope import FUNDS_AT_RISK_CLASSES, ScopeDecision, classify_scope
from eth_scanner.types import (
    DEFAULT_HEAT_THRESHOLD,
    DEFAULT_TVL_FLOOR_USD,
    MAX_HEAT,
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


def _scope_of(ctx: FunnelContext) -> ScopeDecision:
    ir = ctx.ir
    if ir is not None and ir.contract_class and ir.contract_class != "unknown":
        return ScopeDecision(
            contract_class=ir.contract_class,
            scope=ir.scope or "unknown",
            signals=list(ir.scope_signals or []),
            promote=ir.contract_class in FUNDS_AT_RISK_CLASSES,
        )
    source = ctx.source_text or (ctx.artifact.content if ctx.artifact else "")
    extra = list(ir.function_names) if ir is not None else []
    return classify_scope(
        source=source,
        functions=(ir.functions if ir else []),
        extra_names=extra,
        contract_name=(ctx.artifact.contract_name if ctx.artifact else None),
    )


def _cap_heat(heat: int) -> int:
    return min(max(0, int(heat)), MAX_HEAT)


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
    if ir is None or ir.lift_failed or ir_conf == "low" or (ir and ir.unpack_failed):
        reason = "ir_failed_or_low" if not (ir and ir.unpack_failed) else "unpack_failed"
        traces.append(_trace(
            "S2", "manual-review", reason,
            ir_confidence=ir_conf, lift_failed=bool(ir and ir.lift_failed),
            unpack_failed=bool(ir and ir.unpack_failed),
        ))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Do Not Auto-Dismiss: IR build failed, unpack failed, or ir_confidence=low.",
            pattern_leads=pattern_leads,
            movers=_exposed_movers(ir) if ir else [],
            scope=_scope_of(ctx),
        )
    if src_conf == "low":
        traces.append(_trace("S2", "manual-review", "src_confidence=low override", src_confidence=src_conf))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Do Not Auto-Dismiss: src_confidence=low (decompile / unverified) → manual-review.",
            pattern_leads=pattern_leads,
            movers=_exposed_movers(ir),
            scope=_scope_of(ctx),
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

    # --- S4 Value-mover presence + scope filter ----------------------------
    movers = _exposed_movers(ir)
    erc20_leads = _erc20_standard_names(ir)
    scope = _scope_of(ctx)
    erc20_note = ""
    if erc20_leads:
        erc20_note = (
            " ERC20-standard transfer/approve surfaces %s recorded as leads, "
            "not I1 custody movers." % ",".join(erc20_leads[:12])
        )

    if ctx.target.ingest_incomplete and not movers:
        traces.append(_trace(
            "S4", "manual-review",
            "ingest incomplete; movers unknown (not a confirmed empty surface)",
            incomplete_reason=ctx.target.ingest_incomplete_reason,
        ))
        return _done(
            "manual-review", traces, src_conf, ir_conf, heat, notes,
            extra="Do Not Auto-Dismiss: Etherscan/proxy ingest incomplete — not a no-mover close.",
            pattern_leads=pattern_leads,
            scope=scope,
        )

    if scope.demoted:
        traces.append(_trace(
            "S4", "lane-a-cool",
            "no funds-at-risk surface — demoted from the main Lane A path",
            contract_class=scope.contract_class,
            scope=scope.scope,
            signals=scope.signals,
            erc20_standard=erc20_leads,
            movers=movers,
        ))
        traces.append(_trace("S5", "skip", "out-of-scope class — not competing for Lane B"))
        traces.append(_trace("S6", "lane-a-cool", "cool-archive (TVL does not promote tokens/passthrough)"))
        return _done(
            "lane-a-cool", traces, src_conf, ir_conf, heat, notes,
            extra=(
                "Demoted %s from the main scan lane. Lane A only keeps venues that "
                "hold or account third-party value (vault/staking/lending/pool/bridge/maker). "
                "Tokens, wrap-tokens, pass-through routers, and atomic NFT markets do not "
                "compete for Lane B. Not a verdict."
                % scope.contract_class
            ) + erc20_note,
            pattern_leads=pattern_leads,
            movers=movers,
            scope=scope,
        )

    if not movers:
        # Live Eigen DelegationManager (`0x3905…f37A`) was a funds-at-risk
        # family with zero lifted movers → human-no-candidate. Prefer keep.
        if (
            scope.contract_class in FUNDS_AT_RISK_CLASSES
            or "diamond-facets-missing" in scope.signals
        ):
            traces.append(_trace(
                "S4", "continue",
                "in-scope %s with no lifted movers — prefer keep (Do Not Auto-Dismiss)"
                % scope.contract_class,
                contract_class=scope.contract_class,
                signals=scope.signals,
                erc20_standard=erc20_leads,
            ))
        elif ir_conf == "high" and src_conf == "high":
            traces.append(_trace(
                "S4", "human-no-candidate",
                "no custody movers + high IR + verified",
                erc20_standard=erc20_leads,
                contract_class=scope.contract_class,
            ))
            traces.append(_trace("S5", "skip", "no custody movers"))
            traces.append(_trace("S6", "skip", "S4 closed as human-no-candidate (still needs human stamp)"))
            return _done(
                "human-no-candidate", traces, src_conf, ir_conf, heat, notes,
                extra="Candidate auto-no only: high IR + verified + no custody movers. Human still stamps no." + erc20_note,
                pattern_leads=pattern_leads,
                scope=scope,
            )
        else:
            traces.append(_trace(
                "S4", "lane-a-cool",
                "no custody movers; IR not high+verified so not a close",
                erc20_standard=erc20_leads,
                contract_class=scope.contract_class,
            ))
            traces.append(_trace("S5", "skip", "no custody movers"))
            traces.append(_trace("S6", "lane-a-cool", "utility / non-custody with usable IR"))
            return _done(
                "lane-a-cool", traces, src_conf, ir_conf, heat, notes,
                extra="No exposed custody movers; absence is only a close when IR is high and source verified." + erc20_note,
                pattern_leads=pattern_leads,
                scope=scope,
            )
    traces.append(_trace(
        "S4", "continue",
        "exposed value movers=%d class=%s" % (len(movers), scope.contract_class),
        movers=movers, contract_class=scope.contract_class, scope=scope.scope,
    ))

    # --- S5 Cheap I1 auth heat ---------------------------------------------
    # SELF-SCOPED? is treated as WEAK (clear class). True AMBIGUOUS only
    # forces manual-review when *no* mover has a clear PRESENT/WEAK/MISSING
    # bind — high heat + clear movers + weak/missing → keep walking to S6.
    ambiguous_n = 0
    missing_or_weak = False
    all_strong = True
    clear_n = 0
    auth_map: dict[str, str] = {}
    for name in movers:
        auth = _auth_for(ir, name)
        if auth == "SELF-SCOPED?":
            auth = "WEAK"
        auth_map[name] = auth
        if auth == "AMBIGUOUS":
            ambiguous_n += 1
            all_strong = False
        elif auth.startswith("MISSING") or auth == "WEAK":
            missing_or_weak = True
            all_strong = False
            clear_n += 1
            if ir_conf == "high":
                heat += 2
        elif auth == "PRESENT":
            clear_n += 1
        else:
            ambiguous_n += 1
            all_strong = False

    only_ambiguous = ambiguous_n > 0 and clear_n == 0
    if only_ambiguous:
        traces.append(_trace(
            "S5", "manual-review",
            "all cheap auth parses are truly ambiguous",
            auth=auth_map, heat=_cap_heat(heat),
        ))
        return _done(
            "manual-review", traces, src_conf, ir_conf, _cap_heat(heat), notes,
            extra="Ambiguous cheap I1 check → manual-review, never discard.",
            pattern_leads=pattern_leads,
            movers=movers,
            scope=scope,
        )
    if ambiguous_n and clear_n:
        traces.append(_trace(
            "S5", "continue",
            "mixed auth: %d clear / %d ambiguous — not a dismiss" % (clear_n, ambiguous_n),
            auth=auth_map, heat=heat,
        ))
    elif missing_or_weak:
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
    heat = _cap_heat(heat)

    # --- S6 Deep-lane gate -------------------------------------------------
    # Tokens / pass-through never reach here (S4 demote). Funds-at-risk
    # families (lending / vault / staking / pool / bridge / maker) promote
    # on regularity. Generic custody can still promote on heat / TVL / weirdness.
    tvl = float(ctx.target.tvl_usd or 0)
    family_promote = scope.contract_class in FUNDS_AT_RISK_CLASSES
    promote = (
        family_promote
        or heat >= ctx.config.heat_threshold
        or tvl >= ctx.config.tvl_floor_usd
        or bool(set(weird) & {"bridge-mint-release", "custom-share-math", "proxy-delegatecall"})
        or bool(fork and missing_or_weak)
    )
    if promote:
        why = "in-scope %s" % scope.contract_class if family_promote else "heat/TVL/weirdness gate"
        traces.append(_trace(
            "S6", "lane-b-queue",
            why,
            heat=heat, tvl_usd=tvl, weird=weird, fork_family=fork,
            contract_class=scope.contract_class,
            heat_threshold=ctx.config.heat_threshold, tvl_floor=ctx.config.tvl_floor_usd,
        ))
        return _done(
            "lane-b-queue", traces, src_conf, ir_conf, heat, notes,
            extra="Promoted to Lane B (deep invariants). Not a finding.",
            pattern_leads=pattern_leads,
            movers=movers,
            scope=scope,
        )

    traces.append(_trace(
        "S6", "lane-a-cool",
        "below deep-lane gate",
        heat=heat, tvl_usd=tvl, weird=weird, contract_class=scope.contract_class,
    ))
    return _done(
        "lane-a-cool", traces, src_conf, ir_conf, heat, notes,
        extra="Lane A archive with score trail. Human spot-check sample.",
        pattern_leads=pattern_leads,
        movers=movers,
        scope=scope,
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
            scope=_scope_of(ctx),
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
    if not target.has_code and target.ingest_incomplete:
        return _trace(
            "S0", "keep",
            "ingest incomplete — not a confirmed empty EOA",
            ingest_incomplete=True,
            incomplete_reason=target.ingest_incomplete_reason,
        )
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
    scope: Optional[ScopeDecision] = None,
) -> FunnelResult:
    n = list(notes)
    if extra:
        n.append(extra)
    return FunnelResult(
        bucket=bucket,
        dropped=False,
        drop_reason=None,
        heat=_cap_heat(heat),
        src_confidence=src_conf,  # type: ignore[arg-type]
        ir_confidence=ir_conf,  # type: ignore[arg-type]
        stage_trace=traces,
        pattern_leads=pattern_leads or [],
        hypotheses=hypotheses or [],
        notes=n,
        value_movers=movers or [],
        contract_class=scope.contract_class if scope else "unknown",
        scope=scope.scope if scope else "unknown",
        scope_signals=list(scope.signals) if scope else [],
    )
