"""Normalize verified source or decompile text into a thin IR document.

Slither-class SSA is used when the `slither` CLI is present and the
source is verified Solidity (`ir_confidence=high`). Otherwise:

- verified Solidity / Vyper with a parsed function inventory → heuristic CFG (`high`; Slither optional)
- partial / unparsed verified source → heuristic CFG (`med`)
- decompile / failed lift → `low` (never treated as proof)

`ir_confidence` is always set. Weak IR cannot claim yes or auto-no.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

from eth_scanner.heuristics.invariant_pass import run_scan, run_scan_source
from eth_scanner.heuristics.patterns import detect_fork_family, detect_weird_signals, skim_known_patterns
from eth_scanner.heuristics.scope import (
    _diamond_incomplete,
    _focus_chain,
    _ident_match,
    _norm_ident,
    _path_matches_focus,
    _type_blocks,
    _used_libraries,
    classify_scope,
)
from eth_scanner.ingest.unpack import looks_like_etherscan_json, materialize_source, parse_etherscan_sources
from eth_scanner.types import FunctionIR, IRDocument, SourceArtifact


def normalize(
    artifact: SourceArtifact,
    source_dir: Optional[Path] = None,
    try_slither: bool = True,
) -> IRDocument:
    notes: list[str] = []
    src = artifact.content or ""
    language = artifact.language or _guess_lang(artifact)
    src_conf = artifact.src_confidence

    tmp_holder = None
    unpack_failed = False
    lift_failed = False
    if looks_like_etherscan_json(src):
        files = parse_etherscan_sources(src)
        if not files:
            unpack_failed = True
            lift_failed = True
            notes.append(
                "Etherscan JSON payload did not unpack to Solidity/Vyper — "
                "not a no-mover close (Do Not Auto-Dismiss)"
            )
        elif source_dir is None or not source_dir.exists():
            tmp_holder = tempfile.TemporaryDirectory(prefix="eth-scanner-unpack-")
            artifact, unpacked = materialize_source(artifact, Path(tmp_holder.name))
            src = artifact.content or src
            if unpacked and unpacked.exists():
                source_dir = unpacked
                notes.append("normalize unpacked Etherscan multi-file / standard-json source")

    surface: dict[str, Any] = {"files": [], "summary": {}}
    try:
        if unpack_failed:
            surface = {"error": "unpack_failed", "files": [], "summary": {}}
        elif source_dir and source_dir.exists():
            try:
                surface = run_scan([str(source_dir)])
            except Exception as exc:  # noqa: BLE001 — lift failure is a first-class outcome
                lift_failed = True
                surface = {"error": str(exc), "files": [], "summary": {}}
                notes.append("heuristic lift from directory failed: %s" % exc)
        elif src.strip():
            filename = "Contract.vy" if language == "vyper" else "Contract.sol"
            try:
                surface = run_scan_source(src, filename=filename, language=language)
            except Exception as exc:  # noqa: BLE001
                lift_failed = True
                surface = {"error": str(exc), "files": [], "summary": {}}
                notes.append("heuristic lift from source string failed: %s" % exc)
        else:
            lift_failed = True
            surface = {"error": "empty source", "files": [], "summary": {}}
            notes.append("no source or decompile text to lift")
    finally:
        if tmp_holder is not None:
            tmp_holder.cleanup()

    functions = _prefer_primary_functions(
        _functions_from_surface(surface),
        src,
        artifact.contract_name,
    )
    if not lift_failed and not functions and not src.strip():
        lift_failed = True

    slither_ok = False
    if try_slither and src_conf == "high" and language == "solidity" and not lift_failed:
        slither_ok = _try_slither(src, source_dir)
        if slither_ok:
            notes.append("slither CLI present; treating verified Solidity as high-confidence IR")
        else:
            notes.append("slither CLI missing or failed — falling back to heuristic IR")

    fn_count = _surface_function_count(surface)
    ir_conf = _ir_confidence(
        src_conf=src_conf,
        language=language,
        lift_failed=lift_failed,
        slither_ok=slither_ok,
        kind=artifact.kind,
        unpack_failed=unpack_failed,
        function_count=fn_count,
    )
    if lift_failed:
        ir_conf = "low"
        notes.append("IR lift failed → ir_confidence=low → manual-review (Do Not Auto-Dismiss)")
    elif ir_conf == "high" and not slither_ok:
        notes.append(
            "heuristic IR treated as high: verified source + parsed function inventory "
            "(Slither not required)"
        )

    weird = detect_weird_signals(src)
    fork = detect_fork_family(src)
    leads = skim_known_patterns(src)
    accounting: list[dict[str, Any]] = []
    ext: list[dict[str, Any]] = []
    for f in surface.get("files") or []:
        accounting.extend(f.get("accounting") or [])
        ext.extend(f.get("external_calls") or [])

    if artifact.kind == "decompile":
        notes.append("Decompile is a hypothesis generator only. Never proof of safety or theft.")

    fn_names = _function_names_from_surface(surface)
    scope = classify_scope(
        source=src,
        functions=functions,
        extra_names=fn_names,
        contract_name=artifact.contract_name,
    )
    notes.append("scope=%s class=%s signals=%s" % (scope.scope, scope.contract_class, ",".join(scope.signals) or "—"))

    return IRDocument(
        functions=functions,
        ir_confidence=ir_conf,
        src_confidence=src_conf,
        language=language,
        lift_failed=lift_failed,
        lift_tool="slither" if slither_ok else "heuristic",
        notes=notes,
        surface=surface,
        weird_signals=weird,
        pattern_leads=leads,
        accounting_hits=accounting,
        external_calls=ext,
        abi_mismatch_hint=bool(artifact.is_proxy and not artifact.implementation),
        fork_family=fork,
        unpack_failed=unpack_failed,
        contract_class=scope.contract_class,
        scope=scope.scope,
        scope_signals=list(scope.signals),
        function_names=fn_names,
    )


def _guess_lang(artifact: SourceArtifact) -> str:
    if artifact.language in ("solidity", "vyper"):
        return artifact.language
    if (artifact.compiler or "").lower().startswith("vyper"):
        return "vyper"
    return "solidity"


def _functions_from_surface(surface: dict[str, Any]) -> list[FunctionIR]:
    out: list[FunctionIR] = []
    seen: set[tuple[str, str, int]] = set()
    for f in surface.get("files") or []:
        fname = f.get("file") or ""
        for m in f.get("fund_movers") or []:
            vis = m.get("visibility") or ""
            exposed = vis in ("external", "public")
            role = m.get("role") or "custody"
            key = (fname, str(m.get("fn") or "unknown"), int(m.get("line") or 0))
            if key in seen:
                continue
            seen.add(key)
            out.append(FunctionIR(
                name=m.get("fn") or "unknown",
                visibility=vis,
                line=int(m.get("line") or 0),
                end=int(m.get("end") or 0),
                file=fname,
                fund_signals=list(m.get("fund_signals") or []),
                auth_signals=list(m.get("auth_signals") or []),
                auth_heuristic=m.get("auth_heuristic") or "AMBIGUOUS",
                accounting_touched=list(m.get("accounting_touched") or []),
                is_value_mover=role != "erc20-standard",
                exposed=exposed,
                role=role,
            ))
    return out


def _prefer_primary_functions(
    functions: list[FunctionIR],
    src: str,
    contract_name: Optional[str],
) -> list[FunctionIR]:
    """Keep movers from the Etherscan primary + its parents + used libraries.

    Sourcify / standard-json trees ship sibling venues (MetaMorpho + Morpho).
    Those siblings are not *this* address. Diamonds with no matching file
    (or a thin loupe when ContractName misses facets) keep the full set
    (prefer false keep). File-path matching includes path components and
    `using Lib for` libraries that implement movers the primary inherits.
    """
    if not contract_name or not functions:
        return functions
    focus = (contract_name or "").strip()
    chain = _focus_chain(src, focus)
    contracts = [(k, n, b) for k, n, b in _type_blocks(src) if k == "contract"]
    focused = [(k, n, b) for k, n, b in contracts if _norm_in_chain(n, chain, focus)]
    if contracts and focused and _diamond_incomplete(focused, contracts):
        return functions
    used_libs = _used_libraries(src, focus, focused or contracts)
    keep: list[FunctionIR] = []
    for fn in functions:
        path = (fn.file or "").replace("\\", "/")
        if _path_matches_focus(path, focus, chain, used_libs):
            keep.append(fn)
    if not keep:
        return functions
    focused_movers = [f for f in keep if f.is_value_mover and f.exposed]
    all_movers = [f for f in functions if f.is_value_mover and f.exposed]
    if not focused_movers and all_movers:
        return functions
    return keep


def _norm_in_chain(name: str, chain: set[str], focus: str) -> bool:
    key = _norm_ident(name)
    return bool(key and (key in chain or _ident_match(name, focus)))


def _function_names_from_surface(surface: dict[str, Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for f in surface.get("files") or []:
        for raw in f.get("function_names") or []:
            key = str(raw)
            if key and key not in seen:
                seen.add(key)
                names.append(key)
        for m in f.get("fund_movers") or []:
            key = str(m.get("fn") or "")
            if key and key not in seen:
                seen.add(key)
                names.append(key)
    return names


def _surface_function_count(surface: dict[str, Any]) -> int:
    return sum(int(f.get("functions") or 0) for f in (surface.get("files") or []))


def _ir_confidence(
    *,
    src_conf: str,
    language: str,
    lift_failed: bool,
    slither_ok: bool,
    kind: str,
    unpack_failed: bool = False,
    function_count: int = 0,
) -> str:
    if lift_failed or unpack_failed or kind == "decompile" or src_conf == "low":
        return "low"
    if slither_ok and language == "solidity" and src_conf == "high":
        return "high"
    # Clear heuristic inventory on verified Solidity/Vyper. Slither is optional.
    # Zero parsed functions is not a closeable surface — stay med (S4 will cool,
    # not human-no-candidate).
    if src_conf == "high" and language in {"solidity", "vyper"} and function_count > 0:
        return "high"
    return "med"


def _try_slither(src: str, source_dir: Optional[Path]) -> bool:
    if not shutil.which("slither"):
        return False
    try:
        if source_dir and source_dir.exists():
            target = str(source_dir)
            proc = subprocess.run(
                ["slither", target, "--print", "human-summary", "--json", "-"],
                capture_output=True, text=True, timeout=60, check=False,
            )
            return proc.returncode == 0 or bool(proc.stdout.strip())
        with tempfile.TemporaryDirectory(prefix="eth-scanner-slither-") as tmp:
            p = Path(tmp) / "Contract.sol"
            p.write_text(src, encoding="utf-8")
            proc = subprocess.run(
                ["slither", str(p), "--print", "human-summary", "--json", "-"],
                capture_output=True, text=True, timeout=60, check=False,
            )
            if proc.returncode == 0:
                return True
            # Slither often exits non-zero on findings; JSON on stdout still means a lift.
            try:
                json.loads(proc.stdout or "{}")
                return True
            except json.JSONDecodeError:
                return False
    except (OSError, subprocess.TimeoutExpired):
        return False
