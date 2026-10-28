"""L0 — emit a normalized contract IR JSON.

Address, name, Lane A role, ABI (best-effort from source), source paths,
storage layout if solc provides it, impl/facets, selectors.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

from eth_scanner.heuristics.invariant_pass import strip_comments
from eth_scanner.research.keccak import selector4
from eth_scanner.research.proxy import list_diamond_facets, resolve_implementation
from eth_scanner.research.types import ContractIR, SelectorEntry
from eth_scanner.types import IRDocument, SourceArtifact

_TYPE_ALIASES = {
    "uint": "uint256",
    "int": "int256",
    "u256": "uint256",
    "byte": "bytes1",
}
_LOC = frozenset({"memory", "calldata", "storage", "payable"})
_FN_HEAD = re.compile(
    r"function\s+(\w+)\s*\(([^)]*)\)([^;{]*)",
    re.M,
)


def _canonical_type(raw: str) -> str:
    tok = (raw or "").strip()
    if not tok:
        return ""
    parts = [p for p in re.split(r"\s+", tok) if p and p not in _LOC]
    if not parts:
        return ""
    typ = parts[0]
    base = typ
    suffix = ""
    m = re.match(r"^([A-Za-z0-9_]+)(.*)$", typ)
    if m:
        base, suffix = m.group(1), m.group(2)
    base = _TYPE_ALIASES.get(base, base)
    return base + suffix


def _split_params(raw: str) -> list[str]:
    out: list[str] = []
    depth = 0
    cur: list[str] = []
    for ch in raw or "":
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            item = "".join(cur).strip()
            if item:
                out.append(item)
            cur = []
            continue
        cur.append(ch)
    tail = "".join(cur).strip()
    if tail:
        out.append(tail)
    return out


def abi_from_source(source: str, contract_name: str = "") -> list[dict[str, Any]]:
    """Best-effort ABI from Solidity/Vyper text. Not a compiler substitute."""
    clean = strip_comments(source or "", "solidity")
    abi: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in _FN_HEAD.finditer(clean):
        name = m.group(1)
        params = _split_params(m.group(2))
        tail = m.group(3) or ""
        inputs = []
        types: list[str] = []
        for i, p in enumerate(params):
            typ = _canonical_type(p)
            if not typ:
                continue
            types.append(typ)
            inputs.append({"name": "arg%d" % i, "type": typ})
        mut = "nonpayable"
        if re.search(r"\bview\b", tail):
            mut = "view"
        elif re.search(r"\bpure\b", tail):
            mut = "pure"
        elif re.search(r"\bpayable\b", tail):
            mut = "payable"
        vis = "public"
        for cand in ("external", "public", "internal", "private"):
            if re.search(r"\b%s\b" % cand, tail):
                vis = cand
                break
        sig = "%s(%s)" % (name, ",".join(types))
        if sig in seen:
            continue
        seen.add(sig)
        abi.append({
            "type": "function",
            "name": name,
            "inputs": inputs,
            "outputs": [],
            "stateMutability": mut,
            "visibility": vis,
            "signature": sig,
        })
    _ = contract_name
    return abi


def selectors_from_abi(abi: list[dict[str, Any]]) -> list[SelectorEntry]:
    out: list[SelectorEntry] = []
    for item in abi:
        if item.get("type") != "function":
            continue
        name = str(item.get("name") or "")
        if not name:
            continue
        sig = str(item.get("signature") or "")
        if not sig:
            types = []
            for inp in item.get("inputs") or []:
                types.append(str(inp.get("type") or ""))
            sig = "%s(%s)" % (name, ",".join(types))
        try:
            sel = selector4(sig)
        except (UnicodeEncodeError, ValueError):
            sel = ""
        out.append(SelectorEntry(
            name=name,
            signature=sig,
            selector=sel,
            visibility=str(item.get("visibility") or ""),
            state_mutability=str(item.get("stateMutability") or ""),
        ))
    return out


def _source_paths(source_dir: Optional[Path], artifact: Optional[SourceArtifact]) -> list[str]:
    paths: list[str] = []
    if source_dir and source_dir.exists():
        for p in sorted(source_dir.rglob("*")):
            if p.is_file() and p.suffix.lower() in {".sol", ".vy"}:
                paths.append(str(p))
    if not paths and artifact and artifact.contract_name:
        paths.append("%s.sol" % artifact.contract_name)
    return paths


def try_storage_layout(source: str, source_dir: Optional[Path] = None) -> Optional[dict[str, Any]]:
    """Ask solc for storage-layout when the compiler is present. Best effort."""
    if not shutil.which("solc"):
        return None
    if source_dir and source_dir.exists():
        files = list(source_dir.rglob("*.sol"))
        if len(files) != 1:
            return None
        target = files[0]
        try:
            proc = subprocess.run(
                ["solc", "--combined-json", "storage-layout,abi", str(target)],
                capture_output=True, text=True, timeout=30, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if proc.returncode != 0 or not (proc.stdout or "").strip():
            return None
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            return None
    if not (source or "").strip():
        return None
    with tempfile.TemporaryDirectory(prefix="eth-scanner-solc-") as tmp:
        p = Path(tmp) / "Contract.sol"
        p.write_text(source, encoding="utf-8")
        try:
            proc = subprocess.run(
                ["solc", "--combined-json", "storage-layout,abi", str(p)],
                capture_output=True, text=True, timeout=30, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if proc.returncode != 0 or not (proc.stdout or "").strip():
            return None
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            return None


def emit_contract_ir(
    *,
    address: str,
    artifact: Optional[SourceArtifact] = None,
    lane_ir: Optional[IRDocument] = None,
    source_dir: Optional[Path] = None,
    rpc_url: str = "",
    explicit_facets: Optional[list[dict[str, Any]]] = None,
    abi_override: Optional[list[dict[str, Any]]] = None,
) -> ContractIR:
    src = (artifact.content if artifact else "") or ""
    name = (artifact.contract_name if artifact else "") or ""
    if not name:
        m = re.search(r"\bcontract\s+(\w+)", src)
        name = m.group(1) if m else ""
    role = (lane_ir.contract_class if lane_ir else "") or "unknown"
    scope = (lane_ir.scope if lane_ir else "") or "unknown"
    signals = list(lane_ir.scope_signals) if lane_ir else []
    abi = list(abi_override) if abi_override is not None else abi_from_source(src, name)
    selectors = selectors_from_abi(abi)
    impl, impl_src, impl_notes = resolve_implementation(artifact, address=address, rpc_url=rpc_url)
    facets, diamond_status, diamond_notes = list_diamond_facets(
        src, abi=abi, explicit_facets=explicit_facets,
    )
    notes: list[str] = []
    notes.extend(impl_notes)
    notes.extend(diamond_notes)
    if diamond_status == "diamond-facets-missing":
        notes.append("diamond path stopped: facets not listed (Phase 2: eth_call loupe)")
        if "diamond-facets-missing" not in signals:
            signals.append("diamond-facets-missing")
    layout = try_storage_layout(src, source_dir)
    if layout is None:
        notes.append("storage layout unavailable (solc missing, multi-file, or compile failed)")
    language = (artifact.language if artifact else "") or (lane_ir.language if lane_ir else "") or "solidity"
    compiler = artifact.compiler if artifact else None
    return ContractIR(
        address=address,
        name=name,
        role=role,
        scope=scope,
        scope_signals=signals,
        abi=abi,
        source_paths=_source_paths(source_dir, artifact),
        storage_layout=layout,
        implementation=impl,
        implementation_source=impl_src,
        facets=facets,
        diamond_status=diamond_status,
        selectors=selectors,
        notes=notes,
        language=language,
        compiler=compiler,
    )
