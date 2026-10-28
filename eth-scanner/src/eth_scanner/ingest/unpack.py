"""Unpack Etherscan multi-file / Standard-JSON-Input verified sources.

Etherscan stores those payloads as a JSON blob (`{{...}}` or `{sources:...}`)
in `SourceArtifact.content`. Heuristic IR must see real `.sol` / `.vy` files,
not the wrapper. Defensive / local filesystem only — no network.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from eth_scanner.types import SourceArtifact

_FACET_OR_ADAPTER = re.compile(
    r"(Action|Adapter|Facet|Module|Callback|Hook)",
    re.I,
)
_FN_COUNT_SOL = re.compile(r"\bfunction\s+\w+\s*\(")
_FN_COUNT_VY = re.compile(r"^[ \t]*def\s+\w+\s*\(", re.M)

MAX_UNPACK_FILES = 400
_SOL_EXTS = (".sol", ".vy", ".vyper")


def looks_like_etherscan_json(content: str) -> bool:
    s = (content or "").lstrip()
    if not s.startswith("{"):
        return False
    # Compiler `settings` can precede `sources` and exceed 800 chars.
    head = s[:65536]
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


def _source_text_for_count(content: str) -> str:
    text = content or ""
    if looks_like_etherscan_json(text):
        files = parse_etherscan_sources(text)
        if files:
            return flatten_sources(files)
    return text


def _function_count(content: str) -> int:
    text = _source_text_for_count(content)
    return len(_FN_COUNT_SOL.findall(text)) + len(_FN_COUNT_VY.findall(text))


def _substantial_protocol_source(content: str) -> bool:
    """True when the blob looks like a real venue, not a 2-fn proxy stub."""
    text = _source_text_for_count(content)
    n = _function_count(content)
    if n < 4:
        return False
    if n <= 8 and re.search(r"\bdelegatecall\b", text) and re.search(r"\bfallback\b", text):
        return False
    return True


def select_ir_artifact(proxy: SourceArtifact, impl: Optional[SourceArtifact]) -> SourceArtifact:
    """IR lift must use implementation source when Etherscan names one.

    Diamond / Across-style proxies sometimes list a single Action* / Adapter
    facet as `Implementation`. That facet is incomplete. If the proxy address
    also has a substantial verified payload, merge both so HubPool / router
    surfaces are not replaced by `relayTokens` or `addLiquiditySinglePt` alone.
    """
    if impl is not None and (impl.content or "").strip():
        impl.notes = list(impl.notes)
        impl.is_proxy = True
        if not impl.implementation:
            impl.implementation = proxy.implementation
        impl_name = impl.contract_name or ""
        facet_like = bool(_FACET_OR_ADAPTER.search(impl_name)) or not _substantial_protocol_source(impl.content)
        if facet_like and _substantial_protocol_source(proxy.content or ""):
            proxy_body = _source_text_for_count(proxy.content or "")
            impl.notes.append(
                "IR lift merges implementation with proxy verified source "
                "(facet/adapter impl is incomplete)"
            )
            impl.content = (
                _source_text_for_count(impl.content)
                + "\n\n// ----- file: proxy-verified -----\n"
                + proxy_body
            )
            if proxy.contract_name and not _FACET_OR_ADAPTER.search(proxy.contract_name or ""):
                impl.contract_name = proxy.contract_name
            return impl
        impl.notes.append(
            "IR lift uses implementation source (proxy → impl); not proxy-only bytecode/source"
        )
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
