"""Environment + knobs for the ETH scanner. Never log secret values."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from eth_scanner.types import DEFAULT_HEAT_THRESHOLD, DEFAULT_TVL_FLOOR_USD

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORK_DIR = ROOT / "work"
DEFAULT_SUPABASE_URL = "https://xvjqxjakckkbfsdrntwk.supabase.co"


def _split_keys(raw: str) -> list[str]:
    return [p.strip() for p in (raw or "").split(",") if p.strip()]


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _load_dotenv() -> None:
    """Minimal .env loader (no extra dependency). Does not override existing env."""
    for candidate in (ROOT / ".env", ROOT / ".env.local", Path.cwd() / ".env", Path.cwd() / ".env.local"):
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = val


@dataclass
class Settings:
    etherscan_api_keys: list[str] = field(default_factory=list)
    supabase_url: str = DEFAULT_SUPABASE_URL
    supabase_service_role_key: str = ""
    eth_rpc_url: str = ""
    dry_run: bool = False
    work_dir: Path = DEFAULT_WORK_DIR
    heat_threshold: int = DEFAULT_HEAT_THRESHOLD
    tvl_floor_usd: float = DEFAULT_TVL_FLOOR_USD
    etherscan_min_interval_s: float = 0.25
    worker_id: str = "eth-scanner"
    claim_stale_seconds: int = 900

    @property
    def persist_remote(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key) and not self.dry_run


def load_settings() -> Settings:
    _load_dotenv()
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or DEFAULT_SUPABASE_URL
    )
    work = Path(os.environ.get("ETH_SCANNER_WORK_DIR") or DEFAULT_WORK_DIR)
    dry = _env_bool("ETH_SCANNER_DRY_RUN") or not bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    try:
        heat = int(os.environ.get("ETH_SCANNER_HEAT_THRESHOLD") or DEFAULT_HEAT_THRESHOLD)
    except ValueError:
        heat = DEFAULT_HEAT_THRESHOLD
    try:
        tvl = float(os.environ.get("ETH_SCANNER_TVL_FLOOR") or DEFAULT_TVL_FLOOR_USD)
    except ValueError:
        tvl = DEFAULT_TVL_FLOOR_USD
    return Settings(
        etherscan_api_keys=_split_keys(os.environ.get("ETHERSCAN_API_KEYS", "")),
        supabase_url=url.rstrip("/"),
        supabase_service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        eth_rpc_url=os.environ.get("ETH_RPC_URL", ""),
        dry_run=dry,
        work_dir=work,
        heat_threshold=heat,
        tvl_floor_usd=tvl,
        worker_id=os.environ.get("ETH_SCANNER_WORKER_ID", "eth-scanner"),
    )
