"""Lane A worker — S0–S5 (and S6 gate) across as many ETH addresses as limits allow.

Emits heat + bucket. Never a verdict. Never auto-yes. Low IR → manual-review.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

from eth_scanner.config import Settings, load_settings
from eth_scanner.decompile.heimdall import decompile
from eth_scanner.funnel.s0_s7 import FunnelConfig, FunnelContext, run_lane_a
from eth_scanner.ingest.etherscan import (
    EtherscanClient,
    IngestError,
    fetch_rpc_code,
    fingerprint_bytecode,
    has_runtime_code,
    parse_source_result,
)
from eth_scanner.ingest.unpack import materialize_source, select_ir_artifact
from eth_scanner.ir.normalize import normalize
from eth_scanner.store.supabase import ScanStore, artifact_payload, normalize_address, open_store
from eth_scanner.types import FunnelResult, SourceArtifact, Target, to_plain


def run_one(
    address: str,
    *,
    settings: Optional[Settings] = None,
    store: Optional[ScanStore] = None,
    source_path: Optional[Path] = None,
    source_text: Optional[str] = None,
    tvl_usd: Optional[float] = None,
    bytecode: str = "",
) -> FunnelResult:
    settings = settings or load_settings()
    store = store or open_store(settings)
    addr = normalize_address(address)
    closed = store.closed_no_hashes()

    artifact, code, src_dir = _ingest(
        addr,
        settings=settings,
        source_path=source_path,
        source_text=source_text,
        bytecode=bytecode,
    )
    code_hash = fingerprint_bytecode(code) if code else _source_fingerprint(artifact.content)
    target = Target(
        address=addr,
        bytecode_hash=code_hash or None,
        bytecode=code or None,
        tvl_usd=tvl_usd,
        status="running",
        has_code=has_runtime_code(code) if code else bool(artifact.content),
        prior_closed_no=bool(code_hash and code_hash in closed),
    )
    store.upsert_target(target)
    store.save_artifact(addr, artifact.kind, artifact_payload(artifact), artifact.src_confidence)

    ir = normalize(artifact, source_dir=src_dir, try_slither=True)
    store.save_artifact(addr, "ir", to_plain(ir), ir.ir_confidence)

    result = run_lane_a(FunnelContext(
        target=target,
        artifact=artifact,
        ir=ir,
        source_text=artifact.content,
        config=FunnelConfig(heat_threshold=settings.heat_threshold, tvl_floor_usd=settings.tvl_floor_usd),
    ))
    store.save_result(addr, result)
    return result


def run_batch(
    addresses: list[str],
    *,
    settings: Optional[Settings] = None,
    store: Optional[ScanStore] = None,
    source_path: Optional[Path] = None,
    tvl_usd: Optional[float] = None,
) -> list[tuple[str, FunnelResult]]:
    settings = settings or load_settings()
    store = store or open_store(settings)
    out: list[tuple[str, FunnelResult]] = []
    for raw in addresses:
        addr = normalize_address(raw)
        result = run_one(
            addr,
            settings=settings,
            store=store,
            source_path=source_path,
            tvl_usd=tvl_usd,
        )
        out.append((addr, result))
    return out


def claim_and_run(limit: int = 10, *, settings: Optional[Settings] = None) -> list[tuple[str, FunnelResult]]:
    settings = settings or load_settings()
    store = open_store(settings)
    claimed = store.claim_pending(limit, settings.worker_id)
    out: list[tuple[str, FunnelResult]] = []
    for row in claimed:
        result = run_one(row["address"], settings=settings, store=store, tvl_usd=_as_float(row.get("tvl_usd")))
        out.append((row["address"], result))
    return out


def _ingest(
    address: str,
    *,
    settings: Settings,
    source_path: Optional[Path],
    source_text: Optional[str],
    bytecode: str,
) -> tuple[SourceArtifact, str, Optional[Path]]:
    if source_path:
        p = Path(source_path)
        if p.is_file():
            text = p.read_text(encoding="utf-8", errors="replace")
            lang = "vyper" if p.suffix == ".vy" else "solidity"
            art = SourceArtifact(
                kind="source", language=lang, content=text,
                src_confidence="high", verified_match="exact", tool="local",
                notes=["local source (--source); treated as verified for dry-run"],
            )
            dest = settings.work_dir / "sources" / address
            art, src_dir = materialize_source(art, dest)
            # Pass unpacked dir when the file was Etherscan JSON; else scan the string.
            return art, bytecode, src_dir
        if p.is_dir():
            files = list(p.rglob("*.sol")) + list(p.rglob("*.vy"))
            text = "\n\n".join(f.read_text(encoding="utf-8", errors="replace") for f in files[:40])
            art = SourceArtifact(
                kind="source", language="solidity", content=text,
                src_confidence="high", verified_match="exact", tool="local",
                notes=["local source directory"],
            )
            return art, bytecode, p

    if source_text:
        art = SourceArtifact(
            kind="source", language="solidity", content=source_text,
            src_confidence="high", verified_match="exact", tool="local",
        )
        dest = settings.work_dir / "sources" / address
        art, src_dir = materialize_source(art, dest)
        return art, bytecode, src_dir

    code = bytecode
    if settings.eth_rpc_url and not code:
        try:
            code = fetch_rpc_code(settings.eth_rpc_url, address)
        except Exception as exc:  # noqa: BLE001 — read-only lookup; continue without code
            code = ""
            _ = exc

    if settings.etherscan_api_keys:
        client = EtherscanClient(settings.etherscan_api_keys, min_interval_s=settings.etherscan_min_interval_s)
        try:
            raw = client.get_source(address)
            art = parse_source_result(address, raw)
            if not code:
                try:
                    code = client.get_code(address)
                except IngestError:
                    pass
            impl_addr = art.implementation
            # Resolve implementation *before* decompile fallback so IR lifts impl source.
            if impl_addr:
                try:
                    impl_raw = client.get_source(impl_addr)
                    impl = parse_source_result(impl_addr, impl_raw)
                    if impl.content:
                        impl.notes.append("resolved EIP-1967/etherscan implementation %s" % impl_addr)
                    art = select_ir_artifact(art, impl)
                except IngestError:
                    art.notes.append("implementation source fetch failed; staying on proxy artifact")
            if art.src_confidence == "low" or art.kind == "decompile" or not art.content:
                stub = decompile(address, code)
                if impl_addr:
                    stub.is_proxy = True
                    stub.implementation = impl_addr
                    stub.notes.append("decompile fallback; implementation %s source unavailable" % impl_addr)
                art = stub
            dest = settings.work_dir / "sources" / address
            art, src_dir = materialize_source(art, dest)
            return art, code, src_dir
        except IngestError as exc:
            stub = decompile(address, code)
            stub.notes.append("etherscan ingest failed: %s" % exc)
            return stub, code, None

    stub = decompile(address, code)
    stub.notes.append("no ETHERSCAN_API_KEYS and no --source; low-confidence stub")
    return stub, code, None


def _source_fingerprint(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="replace")).hexdigest()


def _as_float(v: object) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
