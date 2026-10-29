"""ETHERSCAN_API_KEYS env wins; empty/unset uses the free-tier /test fallback."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.config import TEST_ETHERSCAN_FALLBACK_KEY, load_settings


class EtherscanKeyFallback(unittest.TestCase):
    def test_unset_uses_fallback(self):
        env = {k: v for k, v in os.environ.items() if k != "ETHERSCAN_API_KEYS"}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("eth_scanner.config._load_dotenv"):
                settings = load_settings()
        self.assertEqual(settings.etherscan_api_keys, [TEST_ETHERSCAN_FALLBACK_KEY])

    def test_empty_uses_fallback(self):
        env = {**os.environ, "ETHERSCAN_API_KEYS": "  "}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("eth_scanner.config._load_dotenv"):
                settings = load_settings()
        self.assertEqual(settings.etherscan_api_keys, [TEST_ETHERSCAN_FALLBACK_KEY])

    def test_env_override_wins(self):
        env = {**os.environ, "ETHERSCAN_API_KEYS": "override-key, other-key"}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("eth_scanner.config._load_dotenv"):
                settings = load_settings()
        self.assertEqual(settings.etherscan_api_keys, ["override-key", "other-key"])


if __name__ == "__main__":
    unittest.main()
