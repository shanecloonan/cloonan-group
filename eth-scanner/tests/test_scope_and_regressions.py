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


def _art(content: str, **kw) -> SourceArtifact:
    base = dict(
        kind="source", language="solidity", content=content,
        src_confidence="high", verified_match="exact", tool="test",
    )
    base.update(kw)
    return SourceArtifact(**base)  # type: ignore[arg-type]


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
    "uni_v3_swaprouter_live_shape.json": "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "uni_v3_pool_live_shape.sol": "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    "uni_v3_pool_live_shape.json": "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    "wsteth_like.sol": "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    "compound_comet_like.sol": "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    "morpho_blue_like.sol": "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    "eigen_delegation_like.sol": "0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A",
    "eigen_strategy_like.sol": "0x858646372CC42E1A627fcE94aa7A7033e7CF075A",
    "across_spoke_like.sol": "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    "across_hub_adapter_like.sol": "0xc186fA914353c44b2E33eBE05f21846F1048bEda",
    "pendle_router_like.sol": "0x888888888889758F76e7103c6CbF23ABbF58F946",
    "pendle_market_like.sol": "0x" + "e1" * 20,
    "uni_v2_router_like.sol": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    "gmx_vault_like.sol": "0x" + "e2" * 20,
    "metamorpho_like.sol": "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
    "metamorpho_tree_like.sol": "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
    "convex_booster_like.sol": "0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
}

LIVE_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
LIVE_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
LIVE_UNI_V3_POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"


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


def _live_swap_router_fns() -> list[FunctionIR]:
    """Movers from the live SwapRouter dry-run after PR #27."""
    custody = dict(
        visibility="external", is_value_mover=True, exposed=True,
        role="custody", auth_heuristic="PRESENT",
    )
    return [
        FunctionIR(name="exactInput", line=10, **custody),
        FunctionIR(name="exactOutput", line=20, **custody),
        FunctionIR(name="uniswapV3SwapCallback", line=30, **custody),
        FunctionIR(name="unwrapWETH9", line=40, **custody),
    ]


def _live_swap_router_extra_names() -> list[str]:
    """Function names the live multi-file Etherscan blob contributes.

    IERC20 + IUniswapV3Pool + IWETH9 are separate verified files. After
    unpack, extra_names look ERC-20 shaped and include slot0 / withdraw.
    """
    return [
        fn.name for fn in _live_swap_router_fns()
    ] + [
        "transfer", "approve", "transferFrom", "balanceOf", "allowance", "totalSupply",
        "name", "symbol", "decimals",
        "slot0", "liquidity", "swap", "mint", "burn", "flash",
        "deposit", "withdraw", "refundETH", "sweepToken",
        "exactInputSingle", "exactOutputSingle",
    ]


def _live_uni_v3_pool_fns() -> list[FunctionIR]:
    custody = dict(
        visibility="external", is_value_mover=True, exposed=True,
        role="custody", auth_heuristic="PRESENT",
    )
    return [
        FunctionIR(name="swap", line=10, **custody),
        FunctionIR(name="mint", line=20, **custody),
        FunctionIR(name="burn", line=30, **custody),
        FunctionIR(name="flash", line=40, **custody),
        FunctionIR(name="collect", line=50, **custody),
        FunctionIR(name="collectProtocol", line=60, **custody),
    ]


def _live_uni_v3_pool_extra_names() -> list[str]:
    """Function names the live multi-file Etherscan blob contributes.

    IERC20Minimal + IUniswapV3Pool + IUniswapV3SwapCallback are separate
    verified files. After unpack, extra_names look ERC-20 shaped *and*
    include uniswapV3SwapCallback / slot0 — the #28 false router demote.
    """
    return [
        fn.name for fn in _live_uni_v3_pool_fns()
    ] + [
        "transfer", "approve", "transferFrom", "balanceOf", "allowance", "totalSupply",
        "name", "symbol", "decimals",
        "slot0", "liquidity", "token0", "token1",
        "uniswapV3SwapCallback", "uniswapV3MintCallback", "uniswapV3FlashCallback",
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
        self.assertTrue(name_is_fund_mover("submit"))
        self.assertTrue(name_is_fund_mover("depositIntoStrategy"))
        self.assertTrue(name_is_fund_mover("queueWithdrawals"))
        self.assertTrue(name_is_fund_mover("completeQueuedWithdrawal"))
        self.assertTrue(name_is_fund_mover("undelegate"))
        self.assertTrue(name_is_fund_mover("depositV3"))
        self.assertTrue(name_is_fund_mover("fillV3Relay"))
        self.assertTrue(name_is_fund_mover("addLiquiditySinglePt"))
        self.assertTrue(name_is_fund_mover("absorb"))
        self.assertTrue(name_is_fund_mover("earmarkRewards"))
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

    def test_live_swap_router_ir_shape_demotes_passthrough(self):
        """Would have caught the live SwapRouter miss after #27.

        Address `0xE592427A0AEce92De3Edee1F18E0157C05861564` returned
        bucket=lane-b-queue / class=custody because the Etherscan multi-file
        blob contributed IERC20 names. Policy: pass-through → cool / router.
        """
        fns = _live_swap_router_fns()
        extra = _live_swap_router_extra_names()
        src = (FIXTURES / "uni_v3_swaprouter_live_shape.json").read_text(encoding="utf-8")
        # Flattened-like source still embeds IERC20 + pool iface + refundETH.
        flat = (
            "interface IERC20 { function transfer(address,uint256) external returns (bool); "
            "function approve(address,uint256) external returns (bool); "
            "function transferFrom(address,address,uint256) external returns (bool); "
            "function balanceOf(address) external view returns (uint256); "
            "function allowance(address,address) external view returns (uint256); "
            "function totalSupply() external view returns (uint256); }\n"
            "interface IUniswapV3Pool { function slot0() external view returns (uint160); "
            "function swap(address,bool,int256,uint160,bytes calldata) external; }\n"
            "interface IWETH9 { function deposit() external payable; function withdraw(uint256) external; }\n"
            "abstract contract PeripheryPayments {\n"
            "    function unwrapWETH9(uint256 amountMinimum, address recipient) public payable {}\n"
            "    function refundETH() external payable { if (address(this).balance > 0) { recipient; } }\n"
            "}\n"
            "contract SwapRouter is PeripheryPayments {\n"
            "    function exactInput(uint256 amountIn, address recipient) external payable returns (uint256) { return amountIn; }\n"
            "    function exactOutput(uint256 amountOut, address recipient) external payable returns (uint256) { return amountOut; }\n"
            "    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {}\n"
            "}\n"
        )
        d = classify_scope(source=flat, functions=fns, extra_names=extra)
        self.assertEqual(d.contract_class, "router")
        self.assertEqual(d.scope, "demoted-passthrough")
        self.assertFalse(d.promote)
        self.assertNotEqual(d.contract_class, "custody")
        self.assertNotEqual(d.scope, "in-scope")

        # Same movers + IERC20 extra_names with empty source (USDC-style IR shape).
        ir_only = classify_scope(source="", functions=fns, extra_names=extra)
        self.assertEqual(ir_only.contract_class, "router")
        self.assertEqual(ir_only.scope, "demoted-passthrough")
        self.assertIn("imported-erc20-on-passthrough", ir_only.signals)

        r = run_lane_a(FunnelContext(
            target=Target(address=LIVE_SWAP_ROUTER, has_code=True, tvl_usd=9_999_999),
            artifact=_art(src),
            ir=IRDocument(
                functions=fns,
                ir_confidence="high",
                src_confidence="high",
                language="solidity",
                lift_tool="test",
                contract_class=d.contract_class,
                scope=d.scope,
                scope_signals=list(d.signals),
                function_names=extra,
            ),
            source_text=flat,
        ))
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(set(r.value_movers), {"exactInput", "exactOutput", "uniswapV3SwapCallback", "unwrapWETH9"})
        self.assertNotEqual(r.bucket, "lane-b-queue")

    def test_live_swap_router_multifile_json_demoted(self):
        r = _lane("uni_v3_swaprouter_live_shape.json", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"exactInput", "exactOutput", "uniswapV3SwapCallback", "unwrapWETH9"})

    def test_live_uni_v3_pool_ir_shape_stays_in_scope(self):
        """USDC/WETH 0.05% pool must stay in-scope. Prefer `pool`; custody keep is OK.

        After #28 the live address `0x88e6…5640` returned lane-a-cool / router
        because the Etherscan blob includes IUniswapV3SwapCallback. Policy:
        reserve AMM → lane-b-queue / pool. Prefer false keep.
        """
        fns = _live_uni_v3_pool_fns()
        src = (FIXTURES / "uni_v3_pool_live_shape.sol").read_text(encoding="utf-8")
        extra = _live_uni_v3_pool_extra_names()
        d = classify_scope(source=src, functions=fns, extra_names=extra)
        self.assertEqual(d.scope, "in-scope")
        self.assertIn(d.contract_class, {"pool", "custody"})
        self.assertEqual(d.contract_class, "pool")
        self.assertNotEqual(d.contract_class, "router")
        self.assertFalse(d.scope in {"demoted-token", "demoted-passthrough"})
        self.assertNotEqual(d.scope, "demoted-passthrough")

        # Same movers + callback/IERC20 extra_names with empty source (live IR).
        ir_only = classify_scope(source="", functions=fns, extra_names=extra)
        self.assertEqual(ir_only.contract_class, "pool")
        self.assertEqual(ir_only.scope, "in-scope")
        self.assertNotEqual(ir_only.contract_class, "router")
        self.assertFalse(ir_only.scope in {"demoted-token", "demoted-passthrough"})

        r = run_lane_a(FunnelContext(
            target=Target(address=LIVE_UNI_V3_POOL, has_code=True, tvl_usd=50_000),
            artifact=_art(src),
            ir=IRDocument(
                functions=fns,
                ir_confidence="high",
                src_confidence="high",
                language="solidity",
                lift_tool="test",
                contract_class=d.contract_class,
                scope=d.scope,
                scope_signals=list(d.signals),
                function_names=extra,
            ),
            source_text=src,
        ))
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.contract_class, "pool")
        self.assertTrue(set(r.value_movers) >= {"swap", "mint", "burn", "flash", "collect", "collectProtocol"})
        self.assertNotEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "router")

        r_sol = _lane("uni_v3_pool_live_shape.sol", tvl=50_000)
        self.assertEqual(r_sol.scope, "in-scope")
        self.assertEqual(r_sol.contract_class, "pool")
        self.assertEqual(r_sol.bucket, "lane-b-queue")
        self.assertNotEqual(r_sol.contract_class, "router")
        self.assertTrue(set(r_sol.value_movers) & {"swap", "mint", "flash", "collectProtocol"})

    def test_live_uni_v3_pool_multifile_json_stays_pool(self):
        r = _lane("uni_v3_pool_live_shape.json", tvl=50_000)
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "router")
        self.assertNotEqual(r.bucket, "lane-a-cool")
        self.assertTrue(set(r.value_movers) & {"swap", "mint", "flash", "collectProtocol"})

    def test_steth_like_stays_staking(self):
        src = """pragma solidity ^0.8.20;
contract LidoStETH {
    function submit(address referral) external payable returns (uint256) { referral; return msg.value; }
    function getPooledEthByShares(uint256 shares) external view returns (uint256) { return shares; }
    function getSharesByPooledEth(uint256 ethAmount) external view returns (uint256) { return ethAmount; }
    function withdraw(uint256 amount) external { amount; }
}
"""
        d = classify_scope(source=src, functions=normalize(_art(src), try_slither=False).functions)
        self.assertEqual(d.contract_class, "staking")
        self.assertEqual(d.scope, "in-scope")
        self.assertTrue(d.promote)

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


class LiveDeFiPass(unittest.TestCase):
    """Regressions for the post-#29 live hunt. Prefer false keep for true custody."""

    def test_wsteth_is_wrap_token_not_staking(self):
        r = _lane("wsteth_like.sol", tvl=10_000_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertNotEqual(r.bucket, "lane-b-queue")

    def test_comet_is_lending_not_custody(self):
        r = _lane("compound_comet_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"supply", "withdraw", "absorb"})

    def test_metamorpho_stays_vault_not_lending(self):
        r = _lane("metamorpho_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "lending")

    def test_metamorpho_sourcify_tree_primary_is_vault(self):
        src = (FIXTURES / "metamorpho_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="MetaMorpho"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertNotEqual(ir.contract_class, "lending")
        d = classify_scope(
            source=src,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="MetaMorpho",
        )
        self.assertEqual(d.contract_class, "vault")
        self.assertNotEqual(d.contract_class, "lending")

    def test_morpho_in_same_tree_stays_lending(self):
        src = (FIXTURES / "metamorpho_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Morpho"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        self.assertNotEqual(ir.contract_class, "vault")

    def test_metamorpho_tree_without_name_still_vault(self):
        # Prefer vault over leaked sibling borrow when 4626 deposit/redeem
        # are present and repay/accrue are not this address.
        src = (FIXTURES / "metamorpho_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertNotEqual(ir.contract_class, "lending")

    def test_ident_match_does_not_confuse_morpho_and_metamorpho(self):
        from eth_scanner.heuristics.scope import _ident_match
        self.assertTrue(_ident_match("MetaMorpho", "MetaMorpho"))
        self.assertTrue(_ident_match("PoolInstance", "Pool"))
        self.assertFalse(_ident_match("Morpho", "MetaMorpho"))
        self.assertFalse(_ident_match("MetaMorpho", "Morpho"))

    def test_convex_booster_is_staking(self):
        r = _lane("convex_booster_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"earmarkRewards", "deposit", "withdraw"})

    def test_morpho_blue_is_lending_not_vault(self):
        r = _lane("morpho_blue_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "vault")
        self.assertTrue(set(r.value_movers) & {"borrow", "liquidate"})

    def test_eigen_delegation_stays_staking_not_human_no(self):
        r = _lane("eigen_delegation_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.bucket, "human-no-candidate")
        self.assertTrue(set(r.value_movers) & {"undelegate", "queueWithdrawals", "completeQueuedWithdrawal"})

    def test_eigen_strategy_is_staking(self):
        r = _lane("eigen_strategy_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"depositIntoStrategy", "withdrawSharesAsTokens"})

    def test_across_spoke_is_bridge(self):
        r = _lane("across_spoke_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"depositV3", "fillV3Relay"})

    def test_across_adapter_relaytokens_is_bridge(self):
        r = _lane("across_hub_adapter_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_pendle_action_router_demoted(self):
        r = _lane("pendle_router_like.sol", tvl=1_000_000)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "lane-b-queue")

    def test_pendle_market_stays_pool(self):
        r = _lane("pendle_market_like.sol")
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_uni_v2_router_is_passthrough_not_pool(self):
        r = _lane("uni_v2_router_like.sol", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "pool")
        self.assertNotEqual(r.bucket, "lane-b-queue")

    def test_gmx_like_vault_in_scope(self):
        r = _lane("gmx_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_mint_py_from_sy_is_not_token_admin_prefix(self):
        from eth_scanner.heuristics.scope import _is_token_admin
        self.assertFalse(_is_token_admin("mintPyFromSy"))
        self.assertFalse(_is_token_admin("burnPyToSy"))
        self.assertTrue(_is_token_admin("mint"))
        self.assertTrue(_is_token_admin("mintTo"))
        self.assertTrue(_is_token_admin("rescueERC20"))

    def test_family_without_movers_is_not_human_no(self):
        ir = IRDocument(
            functions=[],
            ir_confidence="high",
            src_confidence="high",
            language="solidity",
            lift_tool="test",
            contract_class="staking",
            scope="in-scope",
            scope_signals=["eigenlayer"],
        )
        r = run_lane_a(FunnelContext(
            target=Target(address="0x" + "ef" * 20, has_code=True, tvl_usd=0),
            artifact=_art("pragma solidity ^0.8.20;\ncontract DelegationManager {}"),
            ir=ir,
            source_text="pragma solidity ^0.8.20;\ncontract DelegationManager {}",
        ))
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.bucket, "human-no-candidate")


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
