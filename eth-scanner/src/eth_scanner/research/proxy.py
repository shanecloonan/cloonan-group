"""EIP-1967 implementation resolution + diamond facet listing.

No weak proxy guesses. If a diamond loupe is present but facets cannot be
listed from an explicit source, mark `diamond-facets-missing` and stop that
path. Full `eth_call` loupe fetch is Phase 2.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

from eth_scanner.heuristics.invariant_pass import strip_comments
from eth_scanner.research.types import FacetEntry
from eth_scanner.types import SourceArtifact

# EIP-1967 implementation slot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"

_DIAMOND_LOUPE_NAMES = frozenset({
    "facetaddresses", "facetaddress", "facets", "facetfunctionselectors", "diamondcut",
})
_ADDR_RX = re.compile(r"0x[a-fA-F0-9]{40}")


def _rpc_call(rpc_url: str, method: str, params: list[Any], timeout_s: float = 15.0) -> Any:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }).encode("utf-8")
    req = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "eth-scanner-research/0.1 (defensive; read-only)"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode("utf-8", errors="replace"))
    if body.get("error"):
        raise RuntimeError(str(body["error"]))
    return body.get("result")


def eth_get_storage_at(rpc_url: str, address: str, slot: str, timeout_s: float = 15.0) -> str:
    """Read-only `eth_getStorageAt`. Never sends a transaction."""
    return str(_rpc_call(rpc_url, "eth_getStorageAt", [address, slot, "latest"], timeout_s) or "")


def storage_word_to_address(word: str) -> Optional[str]:
    raw = (word or "").strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    if not raw or set(raw) <= {"0"}:
        return None
    if len(raw) < 40:
        raw = raw.zfill(40)
    addr = "0x" + raw[-40:]
    if set(addr[2:]) <= {"0"}:
        return None
    return addr


def looks_like_diamond(source: str, abi: Optional[list[dict[str, Any]]] = None) -> bool:
    names: set[str] = set()
    if abi:
        for item in abi:
            if item.get("type") == "function":
                names.add(str(item.get("name") or "").lower())
    clean = strip_comments(source or "", "solidity")
    for n in _DIAMOND_LOUPE_NAMES:
        if n in names or re.search(r"\b%s\b" % n, clean, re.I):
            names.add(n)
    return bool(names & _DIAMOND_LOUPE_NAMES)


def resolve_implementation(
    artifact: Optional[SourceArtifact],
    *,
    address: str = "",
    rpc_url: str = "",
    get_storage: Optional[Callable[[str, str, str], str]] = None,
) -> tuple[Optional[str], str, list[str]]:
    """Return (implementation, source_tag, notes).

    Order: explorer-reported Implementation, then EIP-1967 slot via RPC.
    Never infers an impl from bytecode patterns.
    """
    notes: list[str] = []
    if artifact and artifact.implementation:
        impl = artifact.implementation.strip().lower()
        if impl.startswith("0x") and len(impl) == 42:
            notes.append("implementation from explorer/artifact (not a bytecode guess)")
            return impl, "explorer", notes

    if not rpc_url and get_storage is None:
        notes.append("no RPC and no explorer implementation — EIP-1967 not read")
        return None, "", notes

    reader = get_storage or (lambda addr, slot, _rpc=rpc_url: eth_get_storage_at(_rpc, addr, slot))
    try:
        word = reader(address, EIP1967_IMPLEMENTATION_SLOT)
    except (OSError, TimeoutError, RuntimeError, urllib.error.URLError, ValueError) as exc:
        notes.append("EIP-1967 eth_getStorageAt failed: %s" % exc)
        return None, "", notes
    impl = storage_word_to_address(word)
    if impl:
        notes.append("implementation from EIP-1967 slot (eth_getStorageAt)")
        return impl, "eip-1967", notes
    notes.append("EIP-1967 implementation slot empty or zero")
    return None, "", notes


def list_diamond_facets(
    source: str,
    *,
    abi: Optional[list[dict[str, Any]]] = None,
    explicit_facets: Optional[list[dict[str, Any]]] = None,
) -> tuple[list[FacetEntry], Optional[str], list[str]]:
    """List facets only when they are explicitly provided.

    If the surface looks like a diamond/loupe and no explicit facet list is
    supplied, return status `diamond-facets-missing` and an empty list.
    Phase 2 will fetch facets via `eth_call` — this path does not guess.
    """
    notes: list[str] = []
    if explicit_facets:
        out: list[FacetEntry] = []
        for row in explicit_facets:
            addr = str(row.get("address") or "").strip().lower()
            if not addr:
                continue
            sels = [str(s) for s in (row.get("selectors") or [])]
            out.append(FacetEntry(address=addr, selectors=sels, source=str(row.get("source") or "explicit")))
        if out:
            notes.append("diamond facets taken from an explicit list (no guess)")
            return out, "listed", notes

    if not looks_like_diamond(source, abi):
        return [], None, notes

    # Refuse to scrape constructor literals / mappings — that is a weak guess.
    stray = _ADDR_RX.findall(source or "")
    if stray:
        notes.append(
            "diamond loupe present; %d address literal(s) in source were not treated as facets"
            % len(stray)
        )
    notes.append("diamond loupe/cut surface without an explicit facet list — diamond-facets-missing")
    return [], "diamond-facets-missing", notes
