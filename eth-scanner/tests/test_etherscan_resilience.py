"""Etherscan rate-limit / parse resilience. No live network."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.ingest.etherscan import (
    EtherscanClient,
    RateLimitError,
    is_rate_limited_payload,
    parse_source_result,
)


class RateLimitDetect(unittest.TestCase):
    def test_message_and_result_strings(self):
        self.assertTrue(is_rate_limited_payload(message="Max rate limit reached"))
        self.assertTrue(is_rate_limited_payload(result="Free API access is rate limited"))
        self.assertTrue(is_rate_limited_payload(status_code=429))
        self.assertFalse(is_rate_limited_payload(message="OK", result=[{"SourceCode": "pragma"}]))
        self.assertFalse(is_rate_limited_payload(message="Contract source code not verified"))

    def test_parse_rejects_rate_limit_string(self):
        with self.assertRaises(RateLimitError):
            parse_source_result("0x" + "11" * 20, "Max rate limit reached")

    def test_parse_empty_is_unverified_not_rate_limit(self):
        art = parse_source_result("0x" + "11" * 20, [{"SourceCode": "", "ContractName": ""}])
        self.assertEqual(art.kind, "decompile")
        self.assertEqual(art.src_confidence, "low")


class ClientBackoff(unittest.TestCase):
    def test_retries_then_raises_rate_limit(self):
        payload = json.dumps({
            "status": "0",
            "message": "NOTOK",
            "result": "Max rate limit reached",
        }).encode("utf-8")

        class _Resp:
            headers = {}

            def read(self):
                return payload

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        client = EtherscanClient(["key1"], min_interval_s=0.0, max_attempts=3)
        with mock.patch("eth_scanner.ingest.etherscan.time.sleep", return_value=None):
            with mock.patch("eth_scanner.ingest.etherscan.urllib.request.urlopen", return_value=_Resp()):
                with self.assertRaises(RateLimitError):
                    client.get_source("0x" + "11" * 20)

    def test_verified_source_returns_result(self):
        row = [{
            "SourceCode": "pragma solidity ^0.8.20;\ncontract C { function ping() external {} }\n",
            "ContractName": "C",
            "Proxy": "0",
        }]
        payload = json.dumps({"status": "1", "message": "OK", "result": row}).encode("utf-8")

        class _Resp:
            headers = {}

            def read(self):
                return payload

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        client = EtherscanClient(["key1"], min_interval_s=0.0, max_attempts=3)
        with mock.patch("eth_scanner.ingest.etherscan.urllib.request.urlopen", return_value=_Resp()):
            out = client.get_source("0x" + "11" * 20)
        art = parse_source_result("0x" + "11" * 20, out)
        self.assertIn("pragma", art.content)
        self.assertEqual(art.src_confidence, "high")


if __name__ == "__main__":
    unittest.main()
