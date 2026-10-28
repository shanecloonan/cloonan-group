"""EIP-2535 loupe eth_call. No network. No facet ABI guessing."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.research.ir import emit_contract_ir
from eth_scanner.research.keccak import selector4
from eth_scanner.research.proxy import (
    decode_address_array,
    decode_bytes4_array,
    encode_address_array,
    encode_bytes4_array,
    list_diamond_facets,
    looks_like_diamond,
)
from eth_scanner.types import SourceArtifact

FIXTURES = ROOT / "tests" / "fixtures"
ADDR = "0x" + "e5" * 20
FACET = "0x" + "cc" * 20


def _art() -> SourceArtifact:
    path = FIXTURES / "diamond_loupe_only_like.sol"
    return SourceArtifact(
        kind="source",
        language="solidity",
        content=path.read_text(encoding="utf-8"),
        src_confidence="high",
        verified_match="exact",
        tool="test",
        contract_name="Diamond",
    )


class Selectors(unittest.TestCase):
    def test_loupe_selectors(self):
        self.assertEqual(selector4("facetAddresses()"), "0x52ef6b2c")
        self.assertEqual(selector4("facets()"), "0x7a0ed627")
        self.assertEqual(selector4("facetFunctionSelectors(address)"), "0xadfca15e")


class AbiRoundTrip(unittest.TestCase):
    def test_address_array(self):
        encoded = encode_address_array([FACET, "0x" + "dd" * 20])
        got = decode_address_array(encoded)
        self.assertEqual(got, [FACET, "0x" + "dd" * 20])

    def test_bytes4_array(self):
        encoded = encode_bytes4_array(["0x12345678", "0xaabbccdd"])
        got = decode_bytes4_array(encoded)
        self.assertEqual(got, ["0x12345678", "0xaabbccdd"])


class LoupeCall(unittest.TestCase):
    def test_no_rpc_still_missing(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        self.assertTrue(looks_like_diamond(src))
        facets, status, notes = list_diamond_facets(src, address=ADDR)
        self.assertEqual(facets, [])
        self.assertEqual(status, "diamond-facets-missing")
        self.assertTrue(any("ETH_RPC_URL unset" in n or "diamond-facets-missing" in n for n in notes))

    def test_eth_call_lists_facets(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        addrs = encode_address_array([FACET])
        sels = encode_bytes4_array(["0x01e1d114"])

        def caller(_addr: str, data: str) -> str:
            if data.startswith(selector4("facetAddresses()")):
                return addrs
            if data.startswith(selector4("facetFunctionSelectors(address)")):
                return sels
            raise RuntimeError("unexpected selector %s" % data[:10])

        facets, status, notes = list_diamond_facets(
            src, address=ADDR, eth_call_fn=caller,
        )
        self.assertEqual(status, "listed")
        self.assertEqual(len(facets), 1)
        self.assertEqual(facets[0].address, FACET)
        self.assertEqual(facets[0].selectors, ["0x01e1d114"])
        self.assertEqual(facets[0].source, "loupe:facetAddresses")
        self.assertTrue(any("facetAddresses" in n for n in notes))

    def test_failed_eth_call_stays_missing(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")

        def caller(_addr: str, _data: str) -> str:
            raise RuntimeError("rpc down")

        facets, status, notes = list_diamond_facets(
            src, address=ADDR, eth_call_fn=caller,
        )
        self.assertEqual(facets, [])
        self.assertEqual(status, "diamond-facets-missing")
        self.assertTrue(any("failed" in n.lower() or "diamond-facets-missing" in n for n in notes))

    def test_source_literals_are_not_guessed_even_with_rpc_flag(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        facets, status, _ = list_diamond_facets(src, address=ADDR, rpc_url="")
        self.assertEqual(status, "diamond-facets-missing")
        self.assertEqual(facets, [])

    def test_ir_still_marks_missing_without_rpc(self):
        ir = emit_contract_ir(address=ADDR, artifact=_art())
        self.assertEqual(ir.diamond_status, "diamond-facets-missing")
        self.assertIn("diamond-facets-missing", ir.scope_signals)


if __name__ == "__main__":
    unittest.main()
