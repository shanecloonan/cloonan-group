"""Unpack Etherscan multi-file / Standard-JSON-Input verified sources.

Etherscan stores those payloads as a JSON blob (`{{...}}` or `{sources:...}`)
in `SourceArtifact.content`. Heuristic IR must see real `.sol` / `.vy` files,
not the wrapper. Defensive / local filesystem only — no network.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from eth_scanner.types import SourceArtifact

MAX_UNPACK_FILES = 400
_SOL_EXTS = (".sol", ".vy", ".vyper")


def looks_like_etherscan_json(content: str) -> bool:
    s = (content or "").lstrip()
    if not s.startswith("{"):
        return False
    head = s[:800]
    return '"sources"' in head or s.startswith("{{") or '"content"' in head


def safe_relpath(raw: str) -> str:
    text = (raw or "").replace("\\", "/").strip()
    parts: list[str] = []
    for part in text.split("/"):
        if not part or part in {".", ".."}:
            continue
        parts.append(part.replace(":", "_"))
    return "/".join(parts) or "Contract.sol"


def parse_etherscan_sources(raw: str) -> dict[str, str]:
    """Return `{relpath: solidity_or_vyper_text}` or `{}` if not multi-file JSON."""
    data = _loads_etherscan_json(raw)
    if not isinstance(data, dict):
        return {}
    sources = data.get("sources") if isinstance(data.get("sources"), dict) else None
    if sources is None and _is_file_map(data):
        sources = data
    if not isinstance(sources, dict):
        return {}

    files: dict[str, str] = {}
    for path, spec in sources.items():
        content: Optional[str] = None
        if isinstance(spec, dict) and isinstance(spec.get("content"), str):
            content = spec["content"]
        elif isinstance(spec, str):
            content = spec
        if not content or not content.strip():
            continue
        rel = safe_relpath(str(path))
        if not rel.lower().endswith(_SOL_EXTS):
            if not _looks_like_source(content):
                continue
            if not rel.lower().endswith((".sol", ".vy")):
                rel = rel + ".sol"
        files[rel] = content
        if len(files) >= MAX_UNPACK_FILES:
            break
    return files


def flatten_sources(files: dict[str, str]) -> str:
    parts: list[str] = []
    for rel in sorted(files):
        body = files[rel].rstrip() + "\n"
        parts.append("// ----- file: %s -----\n%s" % (rel, body))
    return "\n".join(parts)


def unpack_to_dir(files: dict[str, str], dest: Path) -> Path:
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    for rel, content in files.items():
        path = dest / Path(safe_relpath(rel))
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return dest


def materialize_source(
    artifact: SourceArtifact,
    dest: Optional[Path] = None,
) -> tuple[SourceArtifact, Optional[Path]]:
    """Flatten JSON blobs onto `artifact.content` and optionally unpack to `dest`."""
    files = parse_etherscan_sources(artifact.content or "")
    src_dir: Optional[Path] = None
    if files:
        artifact.content = flatten_sources(files)
        artifact.notes.append(
            "unpacked %d-file Etherscan verified source for IR lift" % len(files)
        )
        if dest is not None:
            src_dir = unpack_to_dir(files, dest)
    return artifact, src_dir


def select_ir_artifact(proxy: SourceArtifact, impl: Optional[SourceArtifact]) -> SourceArtifact:
    """IR lift must use implementation source when Etherscan names one."""
    if impl is not None and (impl.content or "").strip():
        impl.notes = list(impl.notes)
        impl.notes.append(
            "IR lift uses implementation source (proxy → impl); not proxy-only bytecode/source"
        )
        impl.is_proxy = True
        if not impl.implementation:
            impl.implementation = proxy.implementation
        return impl
    if impl is not None:
        proxy.notes.append("implementation source empty; IR lift stays on proxy artifact")
    return proxy


def _loads_etherscan_json(raw: str) -> Optional[dict]:
    text = (raw or "").strip()
    if not text:
        return None
    candidates = [text]
    if text.startswith("{{") and text.endswith("}}"):
        candidates.append(text[1:-1])
    if text.startswith("{{"):
        # Extra or truncated wrapping brace (Etherscan sometimes emits `{{...}`).
        candidates.append(text[1:])
    if text.startswith("\ufeff"):
        candidates.append(text.lstrip("\ufeff"))
    for cand in candidates:
        try:
            obj = json.loads(cand)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except json.JSONDecodeError:
                continue
        if isinstance(obj, dict):
            return obj
    return None


def _is_file_map(data: dict) -> bool:
    if not data or "language" in data and "sources" not in data and "settings" in data:
        return False
    hits = 0
    for key, spec in data.items():
        name = str(key).lower()
        has_ext = name.endswith(_SOL_EXTS)
        has_content = (isinstance(spec, dict) and isinstance(spec.get("content"), str)) or isinstance(spec, str)
        if has_ext and has_content:
            hits += 1
    return hits >= 1 and hits >= (len(data) // 2)


def _looks_like_source(content: str) -> bool:
    head = content[:400]
    return (
        "pragma solidity" in head
        or "pragma vyper" in head
        or "SPDX-License-Identifier" in head
        or "\nfunction " in content
        or content.lstrip().startswith(("function ", "contract ", "interface ", "library "))
    )
