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

from eth_scanner.types import DEFAULT_ETHERSCAN_INTERVAL_S, SourceArtifact

ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"
CHAIN_ID = 1  # Ethereum mainnet only
RATE_HINTS = (
    "rate limit", "max rate", "too many requests", "max calls per",
    "rate limiter", "max rate limit reached",
)


class IngestError(RuntimeError):
    pass


class RateLimitError(IngestError):
    """Free-tier starvation — not an unverified or empty contract."""


def is_rate_limited_payload(message: Any = "", result: Any = None, status_code: int = 0) -> bool:
    if status_code == 429:
        return True
    parts = [str(message or "")]
    if isinstance(result, str):
        parts.append(result)
    elif isinstance(result, dict):
        parts.append(str(result.get("message") or ""))
        parts.append(str(result.get("result") or ""))
    blob = " ".join(parts).lower()
    return any(h in blob for h in RATE_HINTS)


def _retry_after_s(headers: Any, attempt: int, cap: float = 30.0) -> float:
    raw = None
    if headers is not None:
        try:
            raw = headers.get("Retry-After")
        except Exception:  # noqa: BLE001
            raw = None
    if raw:
        try:
            return min(cap, max(0.4, float(raw)))
        except (TypeError, ValueError):
            pass
    return min(cap, 1.5 ** (attempt + 1))


@dataclass
class KeyRotator:
    keys: list[str]
    min_interval_s: float = DEFAULT_ETHERSCAN_INTERVAL_S
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
    def __init__(
        self,
        keys: list[str],
        min_interval_s: float = DEFAULT_ETHERSCAN_INTERVAL_S,
        timeout_s: float = 20.0,
        max_attempts: int = 8,
    ):
        self.rotator = KeyRotator(keys=list(keys), min_interval_s=min_interval_s)
        self.timeout_s = timeout_s
        self.max_attempts = max(3, int(max_attempts))

    def get_source(self, address: str) -> Any:
        return self._get({"module": "contract", "action": "getsourcecode", "address": address})

    def get_code(self, address: str) -> str:
        data = self._get({"module": "proxy", "action": "eth_getCode", "address": address, "tag": "latest"})
        if isinstance(data, str):
            return data
        if isinstance(data, dict):
            return str(data.get("result") or data.get("json") or "")
        return str(data or "")

    def _get(self, params: dict[str, Any]) -> Any:
        last_err: Optional[Exception] = None
        saw_rate_limit = False
        retry_hdr = None
        for attempt in range(self.max_attempts):
            key = self.rotator.acquire()
            q = dict(params)
            q["chainid"] = CHAIN_ID
            q["apikey"] = key
            url = ETHERSCAN_V2 + "?" + urllib.parse.urlencode(q)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "eth-scanner/0.3 (defensive; read-only)"})
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                    retry_hdr = resp.headers
                body = json.loads(raw)
            except urllib.error.HTTPError as exc:
                last_err = exc
                if exc.code == 429:
                    saw_rate_limit = True
                    time.sleep(_retry_after_s(exc.headers, attempt))
                    last_err = RateLimitError("HTTP 429")
                    continue
                if exc.code >= 500:
                    time.sleep(min(16.0, 0.8 * (2 ** attempt)))
                    continue
                raise IngestError("etherscan HTTP %s" % exc.code) from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_err = exc
                time.sleep(min(8.0, 0.4 * (2 ** attempt)))
                continue
            status = str(body.get("status", ""))
            message = str(body.get("message") or "")
            result = body.get("result", body)
            if is_rate_limited_payload(message, result):
                saw_rate_limit = True
                last_err = RateLimitError(message or str(result)[:120] or "rate limit")
                time.sleep(_retry_after_s(retry_hdr, attempt))
                continue
            if status == "0" and "NOTOK" in message.upper():
                # Real "not verified" is an empty source, not a retry loop.
                low = message.lower()
                if "not verified" in low or "not found" in low:
                    return result
                last_err = IngestError(message)
                time.sleep(min(4.0, 0.5 * (attempt + 1)))
                continue
            return result
        if saw_rate_limit:
            raise RateLimitError("etherscan rate-limited after %d attempts: %s" % (self.max_attempts, last_err))
        raise IngestError("etherscan failed after rotation: %s" % last_err)


def parse_source_result(address: str, result: Any) -> SourceArtifact:
    if is_rate_limited_payload(result=result) or (
        isinstance(result, str) and is_rate_limited_payload(message=result)
    ):
        raise RateLimitError("etherscan result is a rate-limit payload, not source (%s)" % address)
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
        headers={"Content-Type": "application/json", "User-Agent": "eth-scanner/0.3 (defensive; read-only)"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode("utf-8", errors="replace"))
    return str(body.get("result") or "")
