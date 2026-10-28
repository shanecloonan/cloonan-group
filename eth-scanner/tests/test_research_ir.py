"""L0 IR emission, keccak selectors, EIP-1967 / diamond rules. No network."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.ir.normalize import normalize
from eth_scanner.research.ir import abi_from_source, emit_contract_ir, selectors_from_abi
from eth_scanner.research.keccak import keccak256, selector4
from eth_scanner.research.proxy import (
    EIP1967_IMPLEMENTATION_SLOT,
    list_diamond_facets,
    looks_like_diamond,
    resolve_implementation,
    storage_word_to_address,
)
from eth_scanner.types import SourceArtifact

FIXTURES = ROOT / "tests" / "fixtures"
ADDR = "0x" + "d2" * 20


def _art(path: Path, **kw) -> SourceArtifact:
    text = path.read_text(encoding="utf-8")
    base = dict(
        kind="source",
        language="vyper" if path.suffix == ".vy" else "solidity",
        content=text,
        src_confidence="high",
        verified_match="exact",
        tool="test",
        contract_name=kw.pop("contract_name", path.stem),
    )
    base.update(kw)
    return SourceArtifact(**base)  # type: ignore[arg-type]


class KeccakSelectors(unittest.TestCase):
    def test_empty_digest(self):
        self.assertEqual(
            keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        )

    def test_transfer_selector(self):
        self.assertEqual(selector4("transfer(address,uint256)"), "0xa9059cbb")

    def test_total_assets_selector(self):
        self.assertEqual(selector4("totalAssets()"), "0x01e1d114")


class AbiAndSelectors(unittest.TestCase):
    def test_abi_from_4626_fixture(self):
        src = (FIXTURES / "erc4626_vault_like.sol").read_text(encoding="utf-8")
        abi = abi_from_source(src, "Vault4626")
        names = {x["name"] for x in abi}
        self.assertIn("deposit", names)
        self.assertIn("withdraw", names)
        self.assertIn("totalAssets", names)
        sels = selectors_from_abi(abi)
        by_name = {s.name: s for s in sels}
        self.assertTrue(by_name["deposit"].selector.startswith("0x"))
        self.assertEqual(len(by_name["deposit"].selector), 10)


class ContractIrEmit(unittest.TestCase):
    def test_emits_role_selectors_and_paths(self):
        art = _art(FIXTURES / "erc4626_vault_like.sol", contract_name="Vault4626")
        lane = normalize(art, try_slither=False)
        ir = emit_contract_ir(address=ADDR, artifact=art, lane_ir=lane)
        self.assertEqual(ir.address, ADDR)
        self.assertEqual(ir.name, "Vault4626")
        self.assertEqual(ir.role, "vault")
        self.assertEqual(ir.scope, "in-scope")
        self.assertGreater(len(ir.abi), 3)
        self.assertGreater(len(ir.selectors), 3)
        self.assertIsNone(ir.implementation)
        self.assertIsNone(ir.diamond_status)
        self.assertEqual(ir.facets, [])

    def test_explorer_implementation_is_not_a_guess(self):
        impl = "0x" + "aa" * 20
        art = _art(FIXTURES / "erc4626_vault_like.sol", implementation=impl, is_proxy=True)
        ir = emit_contract_ir(address=ADDR, artifact=art)
        self.assertEqual(ir.implementation, impl)
        self.assertEqual(ir.implementation_source, "explorer")

    def test_eip1967_slot_via_injected_reader(self):
        impl = "0x" + "bb" * 20
        art = _art(FIXTURES / "erc4626_vault_like.sol")

        def reader(_addr: str, slot: str) -> str:
            self.assertEqual(slot, EIP1967_IMPLEMENTATION_SLOT)
            return "0x" + "00" * 12 + impl[2:]

        got, src, notes = resolve_implementation(art, address=ADDR, get_storage=reader)
        self.assertEqual(got, impl)
        self.assertEqual(src, "eip-1967")
        self.assertTrue(any("EIP-1967" in n for n in notes))

    def test_storage_word_zero_is_none(self):
        self.assertIsNone(storage_word_to_address("0x" + "00" * 32))


class DiamondRules(unittest.TestCase):
    def test_loupe_without_explicit_facets_stops(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        self.assertTrue(looks_like_diamond(src))
        facets, status, notes = list_diamond_facets(src)
        self.assertEqual(facets, [])
        self.assertEqual(status, "diamond-facets-missing")
        self.assertTrue(any("diamond-facets-missing" in n for n in notes))

    def test_address_literals_are_not_guessed_as_facets(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        facets, status, _ = list_diamond_facets(src)
        self.assertEqual(status, "diamond-facets-missing")
        self.assertEqual(facets, [])

    def test_explicit_facet_list_is_accepted(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        facets, status, _ = list_diamond_facets(
            src,
            explicit_facets=[{"address": "0x" + "cc" * 20, "selectors": ["0x12345678"]}],
        )
        self.assertEqual(status, "listed")
        self.assertEqual(len(facets), 1)
        self.assertEqual(facets[0].address, "0x" + "cc" * 20)

    def test_ir_marks_diamond_missing(self):
        art = _art(FIXTURES / "diamond_loupe_only_like.sol", contract_name="Diamond")
        lane = normalize(art, try_slither=False)
        ir = emit_contract_ir(address="0x" + "e5" * 20, artifact=art, lane_ir=lane)
        self.assertEqual(ir.diamond_status, "diamond-facets-missing")
        self.assertIn("diamond-facets-missing", ir.scope_signals)


if __name__ == "__main__":
    unittest.main()
