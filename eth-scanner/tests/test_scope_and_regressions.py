"""Scope filter + live-contract regressions. No network. No exploit fixtures."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.heuristics.invariant_pass import classify_auth, name_is_fund_mover, run_scan_source
from eth_scanner.heuristics.scope import classify_scope
from eth_scanner.ir.normalize import normalize
from eth_scanner.lane_a.worker import run_one as lane_a_one
from eth_scanner.store.supabase import MemoryStore
from eth_scanner.types import FunctionIR, IRDocument, SourceArtifact, Target
from eth_scanner.funnel.s0_s7 import FunnelContext, run_lane_a

FIXTURES = ROOT / "tests" / "fixtures"


def _art(content: str) -> SourceArtifact:
    return SourceArtifact(
        kind="source", language="solidity", content=content,
        src_confidence="high", verified_match="exact", tool="test",
    )


_ADDR = {
    "usdc_like.sol": "0x" + "c1" * 20,
    "usdt_like.sol": "0x" + "c2" * 20,
    "weth_like.sol": "0x" + "c3" * 20,
    "aave_v2_like.sol": "0x" + "c4" * 20,
    "aave_v3_like.sol": "0x" + "c5" * 20,
    "balancer_vault_like.sol": "0x" + "c6" * 20,
    "maker_vat_like.sol": "0x" + "c7" * 20,
    "uni_v3_router_like.sol": "0x" + "c8" * 20,
    "open_vault.sol": "0x" + "c9" * 20,
}


def _lane(name: str, tvl: float = 0.0):
    return lane_a_one(
        _ADDR[name],
        store=MemoryStore(),
        source_path=FIXTURES / name,
        tvl_usd=tvl,
    )


class MoverNoise(unittest.TestCase):
    def test_totalsupply_is_not_a_fund_name(self):
        self.assertFalse(name_is_fund_mover("totalSupply"))
        self.assertFalse(name_is_fund_mover("balanceOf"))
        self.assertTrue(name_is_fund_mover("supply"))
        self.assertTrue(name_is_fund_mover("flashLoan"))
        self.assertTrue(name_is_fund_mover("exactInputSingle"))
        self.assertTrue(name_is_fund_mover("transferFrom"))
        self.assertTrue(name_is_fund_mover("joinPool"))
        self.assertTrue(name_is_fund_mover("uniswapV3SwapCallback"))
        self.assertFalse(name_is_fund_mover("transferOwnership"))

    def test_usdt_like_constant_totalsupply_not_a_mover(self):
        src = (FIXTURES / "usdt_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        names = [fn.name for fn in ir.functions]
        self.assertNotIn("totalSupply", names)
        movers = run_scan_source(src)["summary"]["fund_movers"]
        mover_names = [m["fn"] for f in run_scan_source(src)["files"] for m in f.get("fund_movers", [])]
        self.assertNotIn("totalSupply", mover_names)
        self.assertGreaterEqual(movers, 0)

    def test_view_pure_never_movers(self):
        src = (FIXTURES / "utility_no_movers.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        self.assertEqual([fn.name for fn in ir.functions if fn.is_value_mover], [])


class I1Auth(unittest.TestCase):
    def test_maker_wards_auth_is_present(self):
        src = (FIXTURES / "maker_vat_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        by = {fn.name: fn for fn in ir.functions}
        self.assertIn("frob", by)
        self.assertEqual(by["frob"].auth_heuristic, "PRESENT")
        self.assertIn(by["move"].auth_heuristic, {"PRESENT", "WEAK"})
        self.assertNotEqual(by["frob"].auth_heuristic, "AMBIGUOUS")

    def test_router_callback_verify_is_present(self):
        src = (FIXTURES / "uni_v3_router_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        cb = next(fn for fn in ir.functions if fn.name == "uniswapV3SwapCallback")
        self.assertEqual(cb.auth_heuristic, "PRESENT")
        self.assertIn(cb.auth_heuristic, {"PRESENT", "WEAK"})

    def test_classify_auth_self_scoped_is_weak(self):
        strength = classify_auth(
            "withdraw", "function withdraw() external",
            "payable(msg.sender).transfer(1);",
            "function withdraw() external{payable(msg.sender).transfer(1);}",
            [], True,
        )
        self.assertEqual(strength, "WEAK")

    def test_classify_auth_only_owner_present(self):
        strength = classify_auth(
            "withdraw", "function withdraw() external onlyOwner",
            "payable(owner).transfer(1);",
            "function withdraw() external onlyOwner{require(msg.sender==owner);}",
            ["onlyOwner"], True,
        )
        self.assertEqual(strength, "PRESENT")


class ScopeFilter(unittest.TestCase):
    def test_vanilla_token_demoted(self):
        src = (FIXTURES / "vanilla_erc20.sol").read_text(encoding="utf-8")
        d = classify_scope(source=src, functions=normalize(_art(src), try_slither=False).functions)
        self.assertEqual(d.scope, "demoted-token")
        self.assertEqual(d.contract_class, "token")
        self.assertFalse(d.promote)

    def test_usdc_admin_token_demoted(self):
        r = _lane("usdc_like.sol", tvl=1_000_000)
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(r.scope, "demoted-token")
        self.assertNotEqual(r.bucket, "lane-b-queue")
        self.assertNotIn("totalSupply", r.value_movers)

    def test_usdt_like_demoted_and_no_totalsupply_mover(self):
        r = _lane("usdt_like.sol", tvl=1_000_000)
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(r.scope, "demoted-token")
        self.assertNotIn("totalSupply", r.value_movers)

    def test_weth_demoted(self):
        r = _lane("weth_like.sol", tvl=50_000)
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_aave_v2_and_v3_both_lane_b(self):
        v2 = _lane("aave_v2_like.sol")
        v3 = _lane("aave_v3_like.sol")
        self.assertEqual(v2.contract_class, "lending")
        self.assertEqual(v3.contract_class, "lending")
        self.assertEqual(v2.bucket, "lane-b-queue")
        self.assertEqual(v3.bucket, "lane-b-queue")
        self.assertTrue(set(v2.value_movers) & {"deposit", "borrow", "repay", "flashLoan"})
        self.assertTrue(set(v3.value_movers) & {"supply", "borrow", "repay", "flashLoan"})
        self.assertNotEqual(v3.bucket, "manual-review")

    def test_balancer_vault_lane_b(self):
        r = _lane("balancer_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"joinPool", "exitPool", "swap", "flashLoan"})

    def test_maker_vat_lane_b_not_ambiguous(self):
        r = _lane("maker_vat_like.sol")
        self.assertEqual(r.contract_class, "maker")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.bucket, "manual-review")
        self.assertTrue(set(r.value_movers) & {"frob", "flux", "move"})

    def test_uni_router_lane_b_not_ambiguous(self):
        r = _lane("uni_v3_router_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.bucket, "manual-review")
        self.assertTrue(set(r.value_movers) & {"exactInputSingle", "exactInput", "uniswapV3SwapCallback"})

    def test_open_vault_stays_in_scope_custody(self):
        r = _lane("open_vault.sol")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.contract_class, "custody")
        self.assertNotEqual(r.bucket, "human-yes-candidate")

    def test_token_high_tvl_does_not_promote(self):
        ir = IRDocument(
            functions=[
                FunctionIR(
                    name="transfer", visibility="public", line=4, file="T.sol",
                    fund_signals=["(name only: transfer)"], auth_heuristic="PRESENT",
                    is_value_mover=False, exposed=True, role="erc20-standard",
                )
            ],
            ir_confidence="high", src_confidence="high", language="solidity",
            lift_tool="test", contract_class="token", scope="demoted-token",
        )
        src = (FIXTURES / "vanilla_erc20.sol").read_text(encoding="utf-8")
        r = run_lane_a(FunnelContext(
            target=Target(address="0x" + "11" * 20, has_code=True, tvl_usd=9_999_999),
            artifact=_art(src),
            ir=ir,
            source_text=src,
        ))
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(r.scope, "demoted-token")


class UnpackFailureIsNotAClose(unittest.TestCase):
    def test_json_blob_that_does_not_unpack_is_manual_review(self):
        raw = '{ "language": "Solidity", "sources": { "Nope.txt": { "content": "" } } }'
        ir = normalize(_art(raw), try_slither=False)
        self.assertTrue(ir.unpack_failed or ir.lift_failed)
        r = run_lane_a(FunnelContext(
            target=Target(address="0x" + "11" * 20, has_code=True, tvl_usd=0),
            artifact=_art(raw),
            ir=ir,
            source_text=raw,
        ))
        self.assertEqual(r.bucket, "manual-review")
        self.assertFalse(r.dropped)


if __name__ == "__main__":
    unittest.main()
