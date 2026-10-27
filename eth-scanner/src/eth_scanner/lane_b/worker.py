"""Lane B worker — S7 on lane-b-queue and manual-review promotions.

Wraps invariant_pass heuristics into I1–I8 hypothesis stubs.
Never invents BROKEN from greps. Never auto-yes.
"""

from __future__ import annotations

from typing import Optional

from eth_scanner.config import Settings, load_settings
from eth_scanner.funnel.s0_s7 import FunnelConfig, FunnelContext, build_hypotheses, run_lane_b
from eth_scanner.heuristics.invariant_pass import run_scan_source
from eth_scanner.ir.normalize import normalize
from eth_scanner.store.supabase import ScanStore, normalize_address, open_store
from eth_scanner.types import FunnelResult, IRDocument, SourceArtifact, Target, to_plain


def run_one(
    address: str,
    *,
    settings: Optional[Settings] = None,
    store: Optional[ScanStore] = None,
    source_text: Optional[str] = None,
    tvl_usd: Optional[float] = None,
    ir: Optional[IRDocument] = None,
    artifact: Optional[SourceArtifact] = None,
) -> FunnelResult:
    settings = settings or load_settings()
    store = store or open_store(settings)
    addr = normalize_address(address)
    row = store.get_target(addr) or {}
    tvl = tvl_usd if tvl_usd is not None else _as_float(row.get("tvl_usd"))

    if artifact is None and source_text:
        artifact = SourceArtifact(
            kind="source",
            language="solidity",
            content=source_text,
            src_confidence="high",
            verified_match="exact",
            tool="local",
        )
    if artifact is None:
        # Reconstruct a thin artifact from the last stored IR confidence.
        artifact = SourceArtifact(
            kind="source" if row.get("src_confidence") in {"high", "med"} else "decompile",
            language="solidity",
            content=source_text or "",
            src_confidence=row.get("src_confidence") or "low",  # type: ignore[arg-type]
            verified_match="none",
            tool="store",
            notes=["Lane B reconstructed artifact from target row; prefer stored IR."],
        )

    if ir is None:
        ir = normalize(artifact, try_slither=False)

    if source_text:
        extra = run_scan_source(source_text)
        ir.surface = extra
        ir.notes.append("Lane B re-ran invariant_pass heuristics (leads only).")

    hyps = build_hypotheses(ir, tvl)
    target = Target(
        address=addr,
        bytecode_hash=row.get("bytecode_hash"),
        tvl_usd=tvl,
        status="running",
        has_code=True,
    )
    result = run_lane_b(FunnelContext(
        target=target,
        artifact=artifact,
        ir=ir,
        source_text=artifact.content,
        hypotheses=hyps,
        config=FunnelConfig(heat_threshold=settings.heat_threshold, tvl_floor_usd=settings.tvl_floor_usd),
    ))
    store.save_artifact(addr, "report", {
        "lane": "B",
        "hypotheses": to_plain(hyps),
        "notes": result.notes,
    }, result.ir_confidence)
    store.save_result(addr, result)
    return result


def claim_and_run(limit: int = 5, *, settings: Optional[Settings] = None) -> list[tuple[str, FunnelResult]]:
    settings = settings or load_settings()
    store = open_store(settings)
    claimed = store.claim_lane_b(limit, settings.worker_id)
    out: list[tuple[str, FunnelResult]] = []
    for row in claimed:
        result = run_one(row["address"], settings=settings, store=store, tvl_usd=_as_float(row.get("tvl_usd")))
        out.append((row["address"], result))
    return out


def _as_float(v: object) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
