"""End-to-end research pipeline: Lane A gate → IR → L2 → L3 → L4 → L5 → receipt.

Defensive only. No exploit / PoC generation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from eth_scanner.config import Settings, load_settings
from eth_scanner.heuristics.scope import FUNDS_AT_RISK_CLASSES
from eth_scanner.lane_a.worker import run_one as lane_a_one
from eth_scanner.receipt import default_receipt_dir
from eth_scanner.research.detectors import run_custom_detectors
from eth_scanner.research.fork_checks import run_fork_checks
from eth_scanner.research.funds_flow import build_funds_flow, funds_flow_findings
from eth_scanner.research.invariants import (
    generate_invariant_stubs,
    invariant_findings,
    is_foundry_project,
    run_forge_test,
)
from eth_scanner.research.ir import emit_contract_ir
from eth_scanner.research.receipt import write_research_receipts
from eth_scanner.research.slither_runner import run_slither
from eth_scanner.research.types import LayerSkip, ResearchRun
from eth_scanner.store.supabase import MemoryStore, ScanStore, normalize_address, open_store
from eth_scanner.types import FunnelResult, SourceArtifact


def should_proceed(result: FunnelResult) -> tuple[bool, str]:
    """Lane A funds-at-risk gate. Only in-scope / family venues continue."""
    if result.dropped:
        return False, result.drop_reason or "lane-a dropped before a bucket"
    scope = result.scope or "unknown"
    klass = result.contract_class or "unknown"
    signals = list(result.scope_signals or [])
    if scope == "in-scope":
        return True, "lane-a in-scope funds-at-risk (%s)" % klass
    if klass in FUNDS_AT_RISK_CLASSES:
        return True, "lane-a family %s" % klass
    if "diamond-facets-missing" in signals:
        return True, "lane-a false-keep diamond-facets-missing"
    return False, "lane-a gated out: scope=%s class=%s" % (scope, klass)


def _pick_artifact(store: ScanStore, address: str) -> Optional[SourceArtifact]:
    rows = store.list_artifacts(address)
    for row in rows:
        if row.get("kind") not in {"source", "decompile"}:
            continue
        payload = row.get("path_or_json")
        if not isinstance(payload, dict):
            continue
        try:
            return SourceArtifact(
                kind=payload.get("kind") or row.get("kind") or "source",
                language=payload.get("language") or "solidity",
                content=payload.get("content") or "",
                src_confidence=payload.get("src_confidence") or row.get("confidence") or "low",
                verified_match=payload.get("verified_match"),
                compiler=payload.get("compiler"),
                contract_name=payload.get("contract_name"),
                is_proxy=bool(payload.get("is_proxy")),
                implementation=payload.get("implementation"),
                tool=payload.get("tool"),
                notes=list(payload.get("notes") or []),
            )
        except TypeError:
            continue
    return None


def run_research(
    address: str,
    *,
    settings: Optional[Settings] = None,
    store: Optional[ScanStore] = None,
    source_path: Optional[Path] = None,
    source_text: Optional[str] = None,
    tvl_usd: Optional[float] = None,
    receipt_dir: Optional[Path] = None,
    write_receipts: bool = True,
    try_slither: bool = True,
    try_forge: bool = True,
    foundry_project: Optional[Path] = None,
    fork_mock: Optional[dict[str, int]] = None,
    explicit_facets: Optional[list[dict]] = None,
) -> ResearchRun:
    settings = settings or load_settings()
    store = store or open_store(settings)
    addr = normalize_address(address)
    notes: list[str] = [
        "Research stack Phase 1. Defensive reports only. Lane A is the gate.",
    ]

    lane = lane_a_one(
        addr,
        settings=settings,
        store=store,
        source_path=source_path,
        source_text=source_text,
        tvl_usd=tvl_usd,
    )
    proceed, reason = should_proceed(lane)
    run = ResearchRun(
        address=addr,
        gated=not proceed,
        gate_reason=reason,
        role=lane.contract_class or "unknown",
        scope=lane.scope or "unknown",
        lane_a_bucket=lane.bucket,
        layers_run=["L1"],
        notes=notes,
    )
    if not proceed:
        run.layers_skipped.append(LayerSkip(layer="L2", reason=reason))
        run.layers_skipped.append(LayerSkip(layer="L3", reason=reason))
        run.layers_skipped.append(LayerSkip(layer="L4", reason=reason))
        run.layers_skipped.append(LayerSkip(layer="L5", reason=reason))
        run.notes.append("Stopped at L1 — not a Lane A funds-at-risk venue.")
        if write_receipts:
            dest = receipt_dir or default_receipt_dir(settings.work_dir)
            write_research_receipts(run, dest_dir=dest)
        return run

    artifact = _pick_artifact(store, addr)
    if artifact is None and source_path:
        p = Path(source_path)
        if p.is_file():
            artifact = SourceArtifact(
                kind="source",
                language="vyper" if p.suffix == ".vy" else "solidity",
                content=p.read_text(encoding="utf-8", errors="replace"),
                src_confidence="high",
                verified_match="exact",
                tool="local",
            )
    if artifact is None and source_text:
        artifact = SourceArtifact(
            kind="source",
            language="solidity",
            content=source_text,
            src_confidence="high",
            verified_match="exact",
            tool="local",
        )

    src_dir: Optional[Path] = None
    if source_path and Path(source_path).is_dir():
        src_dir = Path(source_path)
    elif settings.work_dir:
        cand = settings.work_dir / "sources" / addr
        if cand.exists():
            src_dir = cand

    lane_ir = None
    if artifact:
        from eth_scanner.ir.normalize import normalize
        lane_ir = normalize(artifact, source_dir=src_dir, try_slither=False)

    contract_ir = emit_contract_ir(
        address=addr,
        artifact=artifact,
        lane_ir=lane_ir,
        source_dir=src_dir,
        rpc_url=settings.eth_rpc_url,
        explicit_facets=explicit_facets,
    )
    run.contract_ir = contract_ir
    run.layers_run.append("L0")
    run.notes.extend(contract_ir.notes)

    source = (artifact.content if artifact else "") or ""
    role = contract_ir.role or run.role

    if try_slither:
        slither_findings, slither_skip, slither_notes = run_slither(
            address=addr, source=source, source_dir=src_dir,
        )
        run.findings.extend(slither_findings)
        run.notes.extend(slither_notes)
        if slither_skip:
            run.layers_skipped.append(slither_skip)
        else:
            run.layers_run.append("L2-slither")
    else:
        run.layers_skipped.append(LayerSkip(layer="L2", reason="slither disabled by flag"))

    custom = run_custom_detectors(address=addr, source=source, role=role, lane_ir=lane_ir)
    run.findings.extend(custom)
    run.layers_run.append("L2-custom")

    graph = build_funds_flow(source=source, lane_ir=lane_ir, language=contract_ir.language)
    run.funds_flow = graph
    run.findings.extend(funds_flow_findings(address=addr, graph=graph))
    run.layers_run.append("L3")

    inv_dest = (receipt_dir or default_receipt_dir(settings.work_dir)).parent / "invariants" / addr
    paths = generate_invariant_stubs(role, inv_dest, address=addr)
    run.invariant_paths = [str(p) for p in paths]
    forge_note = ""
    if paths and try_forge:
        project = foundry_project
        if project is None:
            if source_path and is_foundry_project(Path(source_path)):
                project = Path(source_path)
            elif src_dir and is_foundry_project(src_dir):
                project = src_dir
        if project is not None:
            _rc, forge_note = run_forge_test(project)
        else:
            forge_note = "no foundry.toml fixture — L4 runner skipped (templates written)"
    elif not try_forge:
        forge_note = "forge runner disabled by flag"
    inv_findings, inv_skip = invariant_findings(
        address=addr, role=role, paths=paths, forge_note=forge_note,
    )
    run.findings.extend(inv_findings)
    if paths:
        run.layers_run.append("L4")
    if inv_skip:
        run.layers_skipped.append(inv_skip)

    fork_findings, fork_skips, fork_notes = run_fork_checks(
        address=addr,
        role=role,
        rpc_url=settings.eth_rpc_url,
        mock=fork_mock,
    )
    run.findings.extend(fork_findings)
    run.layers_skipped.extend(fork_skips)
    run.notes.extend(fork_notes)
    if fork_findings and not any(s.layer == "L5" for s in fork_skips):
        run.layers_run.append("L5")
    elif fork_findings:
        run.layers_run.append("L5")

    if write_receipts:
        dest = receipt_dir or default_receipt_dir(settings.work_dir)
        write_research_receipts(run, dest_dir=dest)
    return run


def run_research_batch(
    addresses: list[str],
    **kwargs,
) -> list[ResearchRun]:
    return [run_research(addr, **kwargs) for addr in addresses]


def dry_run_on_fixture(
    fixture: Path,
    address: str,
    *,
    work_dir: Optional[Path] = None,
    fork_mock: Optional[dict[str, int]] = None,
) -> ResearchRun:
    """In-process dry-run used by tests and the CLI --source path."""
    settings = load_settings()
    settings.dry_run = True
    if work_dir is not None:
        settings.work_dir = Path(work_dir)
    store = MemoryStore(work_dir=settings.work_dir)
    return run_research(
        address,
        settings=settings,
        store=store,
        source_path=Path(fixture),
        write_receipts=True,
        try_slither=True,
        try_forge=True,
        fork_mock=fork_mock,
    )
