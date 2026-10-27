"""Etherscan verified-source ingestion with multi-key rotation + rate limits.

Ethereum only (chainid=1). Read-only explorer API. No transactions.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

from eth_scanner.types import SourceArtifact

ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"
CHAIN_ID = 1  # Ethereum mainnet only


class IngestError(RuntimeError):
    pass


@dataclass
class KeyRotator:
    keys: list[str]
    min_interval_s: float = 0.25
    _last: dict[str, float] = field(default_factory=dict)
    _i: int = 0

    def acquire(self) -> str:
        if not self.keys:
            raise IngestError("ETHERSCAN_API_KEYS is empty — set comma-separated keys or use --source / --dry-run")
        n = len(self.keys)
        for _ in range(n * 2):
            key = self.keys[self._i % n]
            self._i += 1
            last = self._last.get(key, 0.0)
            wait = self.min_interval_s - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
            self._last[key] = time.monotonic()
            return key
        return self.keys[0]


class EtherscanClient:
    def __init__(self, keys: list[str], min_interval_s: float = 0.25, timeout_s: float = 20.0):
        self.rotator = KeyRotator(keys=list(keys), min_interval_s=min_interval_s)
        self.timeout_s = timeout_s

    def get_source(self, address: str) -> dict[str, Any]:
        return self._get({"module": "contract", "action": "getsourcecode", "address": address})

    def get_code(self, address: str) -> str:
        data = self._get({"module": "proxy", "action": "eth_getCode", "address": address, "tag": "latest"})
        if isinstance(data, str):
            return data
        return str(data.get("result") or data.get("json") or "")

    def _get(self, params: dict[str, Any]) -> Any:
        last_err: Optional[Exception] = None
        keys_tried = max(1, len(self.rotator.keys))
        for attempt in range(keys_tried + 2):
            key = self.rotator.acquire()
            q = dict(params)
            q["chainid"] = CHAIN_ID
            q["apikey"] = key
            url = ETHERSCAN_V2 + "?" + urllib.parse.urlencode(q)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "eth-scanner/0.1 (defensive; read-only)"})
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                body = json.loads(raw)
            except urllib.error.HTTPError as exc:
                last_err = exc
                if exc.code == 429:
                    time.sleep(min(8.0, 1.5 * (attempt + 1)))
                    continue
                raise IngestError("etherscan HTTP %s" % exc.code) from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_err = exc
                time.sleep(0.5)
                continue
            status = str(body.get("status", ""))
            message = str(body.get("message") or "")
            if "rate limit" in message.lower() or "max rate" in message.lower():
                time.sleep(min(8.0, 1.5 * (attempt + 1)))
                continue
            if status == "0" and "NOTOK" in message.upper():
                last_err = IngestError(message)
                continue
            return body.get("result", body)
        raise IngestError("etherscan failed after rotation: %s" % last_err)


def parse_source_result(address: str, result: Any) -> SourceArtifact:
    row: dict[str, Any]
    if isinstance(result, list) and result:
        row = result[0] if isinstance(result[0], dict) else {}
    elif isinstance(result, dict):
        row = result
    else:
        row = {}
    source = (row.get("SourceCode") or "").strip()
    name = row.get("ContractName") or ""
    compiler = row.get("CompilerVersion") or ""
    proxy = str(row.get("Proxy") or "") == "1"
    impl = (row.get("Implementation") or "").strip() or None
    language = "vyper" if "vyper" in compiler.lower() else "solidity"

    notes: list[str] = []
    if not source:
        notes.append("unverified on Etherscan — decompile fallback (src_confidence=low)")
        return SourceArtifact(
            kind="decompile",
            language="unknown",
            content="",
            src_confidence="low",
            verified_match="none",
            compiler=compiler or None,
            contract_name=name or None,
            is_proxy=proxy,
            implementation=_norm_addr(impl) if impl else None,
            tool="etherscan",
            notes=notes,
        )

    # Etherscan wraps standard-json as {{ ... }}
    content = source
    match = "exact"
    if source.startswith("{{") and source.endswith("}"):
        match = "exact"
        notes.append("standard-json verified source")
    elif source.startswith("{") and '"sources"' in source[:200]:
        match = "exact"
        notes.append("multi-file verified source")
    elif len(source) < 40:
        match = "partial"
        notes.append("short source payload — treat as partial")

    conf: str = "high" if match == "exact" else "med"
    return SourceArtifact(
        kind="source",
        language=language,
        content=content,
        src_confidence=conf,  # type: ignore[arg-type]
        verified_match=match,
        compiler=compiler or None,
        contract_name=name or None,
        is_proxy=proxy,
        implementation=_norm_addr(impl) if impl else None,
        tool="etherscan",
        notes=notes,
    )


def fingerprint_bytecode(bytecode: str) -> str:
    raw = (bytecode or "").strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    return hashlib.sha256(raw.encode("ascii", errors="ignore")).hexdigest()


def has_runtime_code(bytecode: str) -> bool:
    raw = (bytecode or "").strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    return bool(raw) and raw != "0" and raw != ""


def _norm_addr(addr: str) -> str:
    a = addr.strip().lower()
    if not a.startswith("0x"):
        a = "0x" + a
    return a


def fetch_rpc_code(rpc_url: str, address: str, timeout_s: float = 15.0) -> str:
    """Optional read-only eth_getCode. Never sends a transaction."""
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getCode",
        "params": [address, "latest"],
    }).encode("utf-8")
    req = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "eth-scanner/0.1 (defensive; read-only)"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode("utf-8", errors="replace"))
    return str(body.get("result") or "")
