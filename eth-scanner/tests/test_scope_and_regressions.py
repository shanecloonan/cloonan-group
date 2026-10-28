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
    "fiat_token_v2_2_like.json": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "staking_pool_like.sol": "0x" + "d1" * 20,
    "erc4626_vault_like.sol": "0x" + "d2" * 20,
    "yearn_v2_like.sol": "0x" + "d3" * 20,
    "compound_ctoken_like.sol": "0x" + "d4" * 20,
    "uni_v2_pair_like.sol": "0x" + "d5" * 20,
    "curve_pool_like.sol": "0x" + "d6" * 20,
    "seaport_like.sol": "0x" + "d7" * 20,
    "nft_collection_like.sol": "0x" + "d8" * 20,
    "nft_escrow_market_like.sol": "0x" + "d9" * 20,
    "flash_adapter_like.sol": "0x" + "da" * 20,
    "router_with_pool_interface.sol": "0x" + "db" * 20,
}

LIVE_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"


def _live_usdc_fns() -> list[FunctionIR]:
    """Movers from the live USDC dry-run after PR #25: mint/burn/rescueERC20."""
    std = dict(visibility="public", is_value_mover=False, exposed=True, role="erc20-standard", auth_heuristic="PRESENT")
    admin = dict(visibility="external", is_value_mover=True, exposed=True, role="custody", auth_heuristic="PRESENT")
    return [
        FunctionIR(name="transfer", line=10, **std),
        FunctionIR(name="approve", line=20, **std),
        FunctionIR(name="transferFrom", line=30, **std),
        FunctionIR(name="mint", line=40, **admin),
        FunctionIR(name="burn", line=50, **admin),
        FunctionIR(name="rescueERC20", line=60, **admin),
    ]


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
        self.assertTrue(name_is_fund_mover("stake"))
        self.assertTrue(name_is_fund_mover("add_liquidity"))
        self.assertTrue(name_is_fund_mover("repayBorrow"))
        self.assertTrue(name_is_fund_mover("exchange"))
        self.assertFalse(name_is_fund_mover("exchangeRate"))
        self.assertFalse(name_is_fund_mover("exchangeRateStored"))
        self.assertFalse(name_is_fund_mover("transferOwnership"))
        # Live USDC admin is rescueERC20 — name is not word-bounded `rescue`.
        # It becomes a mover via IERC20.transfer in the body, not the name.
        self.assertFalse(name_is_fund_mover("rescueERC20"))
        self.assertTrue(name_is_fund_mover("rescue"))

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
        self.assertEqual(r.contract_class, "token")
        self.assertNotEqual(r.bucket, "lane-b-queue")
        self.assertNotIn("totalSupply", r.value_movers)
        self.assertIn("rescueERC20", r.value_movers)

    def test_live_usdc_rescueerc20_shape_demotes(self):
        """Would have caught the live USDC gap: rescueERC20 is admin, not custody.

        PR #25 fixture used `rescue` (exact TOKEN_ADMIN_NAMES hit). Live
        FiatTokenV2_2 / USDC `0xA0b86991…` lifted mint/burn/rescueERC20 and
        stayed `custody` / `lane-b-queue` via the TVL gate.
        """
        fns = _live_usdc_fns()
        d = classify_scope(
            source="",
            functions=fns,
            extra_names=[fn.name for fn in fns] + [
                "balanceOf", "allowance", "totalSupply", "name", "symbol", "decimals",
            ],
        )
        self.assertEqual(d.contract_class, "token")
        self.assertEqual(d.scope, "demoted-token")
        self.assertIn("token-admin-only", d.signals)
        self.assertFalse(d.promote)

        ir = IRDocument(
            functions=fns,
            ir_confidence="high",
            src_confidence="high",
            language="solidity",
            lift_tool="test",
        )
        r = run_lane_a(FunnelContext(
            target=Target(address=LIVE_USDC, has_code=True, tvl_usd=30_000_000_000),
            artifact=_art("pragma solidity ^0.8.20;\ncontract FiatTokenV2_2 {}"),
            ir=ir,
            source_text="pragma solidity ^0.8.20;\ncontract FiatTokenV2_2 {}",
        ))
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(set(r.value_movers), {"mint", "burn", "rescueERC20"})
        self.assertNotEqual(r.bucket, "lane-b-queue")

    def test_fiat_token_v2_2_multifile_demoted(self):
        r = _lane("fiat_token_v2_2_like.json", tvl=30_000_000_000)
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.contract_class, "token")
        self.assertTrue(set(r.value_movers) >= {"mint", "burn", "rescueERC20"})
        self.assertNotEqual(r.bucket, "lane-b-queue")

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

    def test_uni_router_passthrough_demoted(self):
        """Policy (iter 4): pure exactInput routers do not hold funds — cool-archive.

        Earlier iterations promoted SwapRouter to lane-b as `router`. Money is
        not at rest there; the pool holds reserves.
        """
        r = _lane("uni_v3_router_like.sol", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.bucket, "manual-review")
        self.assertTrue(set(r.value_movers) & {"exactInputSingle", "exactInput", "uniswapV3SwapCallback"})

    def test_router_with_embedded_pool_iface_still_passthrough(self):
        r = _lane("router_with_pool_interface.sol", tvl=50_000)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_open_vault_is_eth_custody_vault(self):
        r = _lane("open_vault.sol")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.bucket, "human-yes-candidate")

    def test_lending_plus_rescueerc20_stays_lending(self):
        src = (FIXTURES / "aave_v2_like.sol").read_text(encoding="utf-8")
        src = src.replace(
            "    function flashLoan",
            "    function rescueERC20(address token, address to, uint256 value) external {\n"
            "        IERC20V2(token).transfer(to, value);\n"
            "    }\n\n    function flashLoan",
        )
        d = classify_scope(source=src, functions=normalize(_art(src), try_slither=False).functions)
        self.assertEqual(d.contract_class, "lending")
        self.assertEqual(d.scope, "in-scope")
        self.assertTrue(d.promote)

    def test_erc20_plus_non_admin_withdraw_stays_custody(self):
        src = """pragma solidity ^0.8.20;
interface IERC20X { function transfer(address, uint256) external returns (bool); }
contract HybridTokenVault {
    string public name = "Hybrid";
    string public symbol = "HYB";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function transfer(address to, uint256 value) public returns (bool) { balanceOf[to] += value; return true; }
    function approve(address spender, uint256 value) public returns (bool) { allowance[msg.sender][spender] = value; return true; }
    function transferFrom(address from, address to, uint256 value) public returns (bool) { balanceOf[to] += value; from; return true; }
    function withdraw(address token, uint256 amt) external {
        IERC20X(token).transfer(msg.sender, amt);
    }
}
"""
        d = classify_scope(source=src, functions=normalize(_art(src), try_slither=False).functions)
        self.assertEqual(d.contract_class, "custody")
        self.assertEqual(d.scope, "in-scope")
        self.assertFalse(d.promote)

    def test_staking_pool_lane_b(self):
        r = _lane("staking_pool_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"stake", "unstake", "getReward"})

    def test_erc4626_hybrid_token_stays_vault(self):
        r = _lane("erc4626_vault_like.sol", tvl=0)
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"deposit", "withdraw"})

    def test_yearn_v2_hybrid_stays_vault(self):
        r = _lane("yearn_v2_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_compound_ctoken_hybrid_stays_lending(self):
        r = _lane("compound_ctoken_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"mint", "borrow", "repayBorrow"})

    def test_uni_v2_pair_hybrid_stays_pool(self):
        r = _lane("uni_v2_pair_like.sol")
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"swap"})

    def test_curve_pool_hybrid_stays_pool(self):
        r = _lane("curve_pool_like.sol")
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"add_liquidity", "exchange"})

    def test_seaport_atomic_market_demoted(self):
        r = _lane("seaport_like.sol", tvl=1_000_000)
        self.assertEqual(r.contract_class, "nft-market")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "lane-b-queue")

    def test_nft_collection_demoted(self):
        r = _lane("nft_collection_like.sol", tvl=50_000)
        self.assertEqual(r.contract_class, "nft")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_nft_escrow_market_kept(self):
        r = _lane("nft_escrow_market_like.sol")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_flash_adapter_without_reserves_demoted(self):
        r = _lane("flash_adapter_like.sol")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "lending")

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


class HeuristicIRQuality(unittest.TestCase):
    def test_clear_verified_surface_is_high_without_slither(self):
        src = (FIXTURES / "aave_v3_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        self.assertEqual(ir.ir_confidence, "high")
        self.assertEqual(ir.lift_tool, "heuristic")
        self.assertFalse(ir.lift_failed)
        self.assertTrue(any("Slither not required" in n for n in ir.notes))

    def test_empty_contract_stays_med_not_a_close(self):
        src = "pragma solidity ^0.8.20;\ncontract Empty {}\n"
        ir = normalize(_art(src), try_slither=False)
        self.assertEqual(ir.ir_confidence, "med")
        r = run_lane_a(FunnelContext(
            target=Target(address="0x" + "ee" * 20, has_code=True, tvl_usd=0),
            artifact=_art(src),
            ir=ir,
            source_text=src,
        ))
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "human-no-candidate")

    def test_dsauth_cancall_is_present(self):
        strength = classify_auth(
            "withdraw", "function withdraw() external",
            "require(canCall(msg.sender, address(this), msg.sig));",
            "function withdraw() external{require(canCall(msg.sender, address(this), msg.sig));}",
            ["canCall("], True,
        )
        self.assertEqual(strength, "PRESENT")


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
