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
    "balancer_vault_like.sol": "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
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
    "pendle_market_like.sol": "0x34280882267ffa6383b363e278b027be083bbe3b",
    "pendle_market_live_shape.json": "0x34280882267ffa6383b363e278b027be083bbe3b",
    "uni_v2_router_like.sol": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    "gmx_vault_like.sol": "0x" + "e2" * 20,
    "gmx_token_like.sol": "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
    "yearn_v2_public_getter_like.sol": "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE",
    "across_hub_like.sol": "0xc186fA914353c44b2E33eBE05f21846F1048bEda",
    "diamond_thin_primary_like.sol": "0x" + "e3" * 20,
    "diamond_thin_primary_like.json": "0x" + "e3" * 20,
    "inherited_lib_movers_like.sol": "0x" + "e4" * 20,
    "inherited_lib_movers_like.json": "0x" + "e4" * 20,
    "metamorpho_like.sol": "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
    "metamorpho_tree_like.sol": "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
    "convex_booster_like.sol": "0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
    "yearn_yvusdc_vyper_live_shape.vy": "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE",
    "yearn_vyper_public_getter_like.vy": "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE",
    "across_hub_live_shape.json": "0xc186fA914353c44b2E33eBE05f21846F1048bEda",
    "pendle_router_v4_live_shape.json": "0x888888888889758F76e7103c6CbF23ABbF58F946",
    "diamond_loupe_only_like.sol": "0x" + "e5" * 20,
    "diamond_router_like.json": "0x" + "e6" * 20,
    "dai_like.sol": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "weeth_like.sol": "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
    "eeth_like.sol": "0x35fA164735182de50811E8e2E824cFb9B6118ac2",
    "sdai_like.sol": "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
    "rseth_like.sol": "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
    "rseth_wrap_like.sol": "0x" + "f1" * 20,
    "rseth_tree_like.sol": "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
    "kelp_deposit_pool_like.sol": "0x036676389e48133B63a802f8635AD39E752D375D",
    "ezeth_like.sol": "0xbf5495Efe5DB9ce00f80364C8B423567e58d2110",
    "ezeth_wrap_like.sol": "0x" + "f2" * 20,
    "ezeth_tree_like.sol": "0xbf5495Efe5DB9ce00f80364C8B423567e58d2110",
    "cbeth_like.sol": "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704",
    "cbeth_wrap_like.sol": "0x" + "f3" * 20,
    "hop_l1_eth_bridge_like.sol": "0xb8901acB165ed027E32754E0FFe830802919777f",
    "optimism_portal_like.sol": "0xbEb5Fc579115071764c7423A4f12eDde41f106Ed",
    "op_standard_bridge_like.sol": "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
    "arbitrum_inbox_like.sol": "0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f",
    "yearn_yvusdc_etherscan_live_shape.vy": "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE",
    "hop_l1_erc20_bridge_live_shape.sol": "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a",
    "optimism_portal2_impl_live_shape.sol": "0x1005217ad392dc64cef501fa1777a27d42166748",
    "l1_standard_bridge_impl_live_shape.sol": "0xb37a11aadf167b2f0b8dd85372de4bc66cd4a891",
    "arb_inbox_impl_live_shape.sol": "0x7c058ad1d0ee415f7e7f30e62db1bcf568470a10",
    "polygon_ether_predicate_like.sol": "0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30",
    "polygon_erc20_predicate_like.sol": "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf",
    "polygon_deposit_manager_like.sol": "0x401F6c983eA34274ec46f84D70b31C151321188b",
    "scroll_l1_eth_gateway_like.sol": "0x7F2b8C31F88B6006c382775eea88297Ec1e3E905",
    "scroll_l1_messenger_like.sol": "0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367",
    "starknet_eth_bridge_like.sol": "0xae0Ee0A63A2cE6BaeEFFE56e7714FB4EFE48D419",
    "zksync_mailbox_like.sol": "0x32400084C286CF3E17e7B677ea9583e60a000324",
    "zksync_l1_erc20_bridge_like.sol": "0x57891966931Eb4Bb6FB81430E6cE0A03AAbDe063",
    "sweth_like.sol": "0xf951E335afb289353dc249e82926178EaC7DEd78",
    "sweth_tree_like.sol": "0xf951E335afb289353dc249e82926178EaC7DEd78",
    "meth_like.sol": "0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa",
    "meth_tree_like.sol": "0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa",
    "reth_like.sol": "0xae78736Cd615f374D3085123A210448E74Fc6393",
    "woeth_wrap_like.sol": "0xDcEe70654261AF21C44c093C300eD3Bb97b78064",
    "yearn_yvweth_etherscan_live_shape.vy": "0xa258C4606Ca8206D8aA700cE2143D7db854D168c",
    "yearn_yvdai_etherscan_live_shape.vy": "0xdA816459F1AB5631232FE5e97a05BBBb94970c95",
    "rsweth_like.sol": "0xFAe1031830626743d967e01CFD7709F74CDCB7dA",
    "rsweth_tree_like.sol": "0xFAe1031830626743d967e01CFD7709F74CDCB7dA",
    "fx_erc20_root_tunnel_like.sol": "0x0cc2caed31490b546c741bd93dbba8ab387f7f2c",
    "fx_root_like.sol": "0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2",
    "scroll_l1_weth_gateway_like.sol": "0x7AC440cAe8EB6328de4fA621163a792c1EA9D4fE",
    "curve_gauge_like.vy": "0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A",
    "aura_booster_like.sol": "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234",
    "spark_pool_like.sol": "0xC13e21B648A5Ee794902342038FF3aDAB66BE987",
    "liquity_trove_like.sol": "0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2",
    "usds_like.sol": "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
    "susds_like.sol": "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
    "fluid_liquidity_proxy_like.sol": "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497",
    "fluid_liquidity_dummy_like.sol": "0xcc331daf69752bece3dc98dbc63eacd5092266a2",
    "lido_withdrawal_queue_like.sol": "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
    "rocket_deposit_pool_like.sol": "0x2cac916b2A963Bf162f076C0a8a4a8200BCFBfb4",
    "renzo_restake_manager_like.sol": "0x74a09653A083691711cF8215a6ab074BB4e99ef5",
    "liquity_borrower_ops_like.sol": "0x24179CD81c9e782A4096035f7eC97fB8B783e007",
    "maker_pot_like.sol": "0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7",
    "weth_gateway_like.sol": "0xBD7D6a9ad7865463DE44B05F04559f65e3B11704",
    "dai_join_like.sol": "0x9759A6Ac90977b93B58547b4A71c78317f391A28",
    "gem_join_like.sol": "0x2F0b23f53734252Bda2277357e97e1517d6B042A",
    "dss_lite_psm_like.sol": "0xf6e72Db5454dd049d0788e411b06CfAF16853042",
    "dsr_manager_like.sol": "0x373238337Bfe1146fb49989fc222523f83081dDb",
    "gearbox_credit_manager_like.sol": "0x3EB95430FdB99439A86d3c6D7D01C3c561393556",
    "cow_settlement_like.sol": "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    "frxeth_like.sol": "0x5E8422345238F34275888049021821E8E08Caa1f",
    "uni_v4_pool_manager_like.sol": "0x000000000004444c5dc75cB358380D2e3dE08A90",
    "usds_join_like.sol": "0x3C0f895007CA717Aa01c8693e59DF1e8C3777FEB",
    "dai_usds_like.sol": "0x3225737a9Bbb6473CB4A45b7244ACa2BeFdB276A",
    "euler_evault_like.sol": "0x8Ff1C814719096b61aBf00Bb46EAd0c9A529Dd7D",
    "gearbox_pool_v3_like.sol": "0xda00000035fef4082F78dEF6A8903bee419FbF8E",
    "crvusd_controller_like.sol": "0x4e59541306910aD6dC1daC0AC9dFB29bD9F15c67",
    "crvusd_llamma_like.vy": "0x2B7e624bdb839975d56D8428d9f6A4cf1160D3e9",
    "contango_vault_like.sol": "0x3F37C7d8e61C000085AAc0515775b06A3412F36b",
    "comet_rewards_like.sol": "0x1B0e765F6224C21223AeA2af16c1C46E38885a40",
    "pool_addresses_provider_like.sol": "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    "usde_like.sol": "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    "susde_like.sol": "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
    "sfrxeth_like.sol": "0xac3E018457B222d93114458476f3E3416Abbe38F",
    "liquity_v2_trove_like.sol": "0x7bcb64b2c9206a5b699ed43363f6f98d4776cf5a",
    "liquity_v2_stability_like.sol": "0x5721cbbd64fc7ae3ef44a0a3f9a790a9264cf9bf",
    "bold_like.sol": "0x6440f144b7e50D6a8439336510312d2F54beB01D",
    "yearn_v3_vault_like.sol": "0xc1F484Dee9a586c122D658B8AFE3436c2F4290be",
    "puffer_vault_like.sol": "0x3b2fdFdEFE919dBcCE0bc5ac426097d5523B8AFA",
    "maple_pool_like.sol": "0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b",
    "maple_syrup_router_like.sol": "0x134cCaaA4F1e4552eC8aEcb9E4A2360dDcF8df76",
    "stargate_pool_like.sol": "0xc026395860Db2d07ee33e05fE50ed7bD583189C7",
    "stargate_token_messaging_like.sol": "0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980",
    "enzyme_vault_like.sol": "0x891dee0483eBAA922E274ddD2eBBaA2D33468A38",
    "origin_oeth_vault_like.sol": "0x0E979edF516f88119fa2843fA3f08A9643F8e575",
    "etherfi_liquidity_pool_like.sol": "0x308861A430be4cce5502d0A12724771Fc6DaF216",
    "treehouse_router_like.sol": "0xeFA3fa8e85D2b3CfdB250CdeA156c2c6C90628F5",
    "usual_dao_collateral_like.sol": "0xde6e1F680C4816446C8D515989E2358636A38b04",
    "rtoken_like.sol": "0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F",
    "teth_vault_like.sol": "0x551d155760ae96050439AD24Ae98A96c765d761B",
    "teth_tasset_like.sol": "0xD11c452fc99cF405034ee446803b6F6c1F6d5ED8",
    "usd0pp_like.sol": "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
    "folio_deployer_like.sol": "0x4D201a6e5BF975E2CEE9e5cbDfc803C0Ff122073",
    "folio_like.sol": "0xb6b35b2c7032E00BAa2535Ba480d461321B7E0A6",
    "ccip_lock_release_like.sol": "0x8113f001eA456759264317007220cBc939cA8435",
    "reserve_backing_manager_like.sol": "0xF014FEF41cCB703975827C8569a3f0940cFD80A4",
    "mantle_unstake_queue_like.sol": "0x38fDF7b489316e03eD8754ad339cb5c4483FDcf9",
    "mantle_staking_like.sol": "0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f",
    "treehouse_redemption_like.sol": "0x62fb2022c4be4586432f298de9a404da92d9dd90",
    "fraxlend_pair_like.sol": "0x78bB3aEC3d855431bd9289fD98dA13F9ebB7ef15",
    "sommelier_cellar_like.sol": "0x99bA1Ef93A5ef0596Bb14B45e9D313eD5969bfe6",
    "term_repo_collateral_like.sol": "0xb99F5a082465b4cD8037E28Ac7e0BF81B609Df53",
    "term_repo_locker_like.sol": "0xFCf4eF17D1BC11dF6c6200A809C54cB06F16e86e",
    "liquid_collective_like.sol": "0x8c1BEd5b9a0928467c9B1341Da1D7BD5e10b6549",
    "veda_boring_vault_like.sol": "0xf0bb20865277aBd641a307eCe5Ee04E79073416C",
    "veda_teller_like.sol": "0x9AA79C84b79816ab920bBcE20f8f74557B514734",
    "veda_queue_like.sol": "0x0D2dF071207E18Ca8638b4f04E98c53155eC2cE0",
    "upshift_vault_like.sol": "0x3EAa4b3e8967c02cE1304C1EB35e8C5409838DFC",
    "mellow_vault_like.sol": "0x76001faFd4a8d3E8Cd399e19B91296Bc8bD0bb84",
    "clearpool_pool_like.sol": "0x2E1CE0F2ab6B61d5A3d1682a77496c4611860B57",
    "mellow_root_vault_like.sol": "0xa1eeEb677a121327Ea2643Fb47a23fec304Edd00",
    "concrete_async_vault_like.sol": "0xd57588c73715b65e0ead36ae06c15644169501b7",
}

LIVE_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
LIVE_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
LIVE_UNI_V3_POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
LIVE_PENDLE_MARKET = "0x34280882267ffa6383b363e278b027be083bbe3b"
LIVE_YEARN_YVUSDC = "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE"
LIVE_ACROSS_HUB = "0xc186fA914353c44b2E33eBE05f21846F1048bEda"
LIVE_GMX_TOKEN = "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a"
LIVE_DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
LIVE_WEETH = "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee"
LIVE_EETH = "0x35fA164735182de50811E8e2E824cFb9B6118ac2"
LIVE_SDAI = "0x83F20F44975D03b1b09e64809B757c47f942BEeA"
LIVE_PENDLE_ROUTER = "0x888888888889758F76e7103c6CbF23ABbF58F946"
LIVE_RSETH = "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7"
LIVE_EZETH = "0xbf5495Efe5DB9ce00f80364C8B423567e58d2110"
LIVE_CBETH = "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704"
LIVE_HOP_ETH = "0xb8901acB165ed027E32754E0FFe830802919777f"
LIVE_OP_PORTAL = "0xbEb5Fc579115071764c7423A4f12eDde41f106Ed"
LIVE_OP_STD_BRIDGE = "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1"
LIVE_ARB_INBOX = "0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f"
LIVE_HOP_ERC20 = "0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a"
LIVE_OP_PORTAL_IMPL = "0x1005217ad392dc64cef501fa1777a27d42166748"
LIVE_OP_STD_BRIDGE_IMPL = "0xb37a11aadf167b2f0b8dd85372de4bc66cd4a891"
LIVE_ARB_INBOX_IMPL = "0x7c058ad1d0ee415f7e7f30e62db1bcf568470a10"
LIVE_POLY_ETHER_PRED = "0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30"
LIVE_SCROLL_ETH_GW = "0x7F2b8C31F88B6006c382775eea88297Ec1e3E905"
LIVE_STARKNET_ETH = "0xae0Ee0A63A2cE6BaeEFFE56e7714FB4EFE48D419"
LIVE_ZKSYNC_DIAMOND = "0x32400084C286CF3E17e7B677ea9583e60a000324"
LIVE_SWETH = "0xf951E335afb289353dc249e82926178EaC7DEd78"
LIVE_METH = "0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa"
LIVE_RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393"
LIVE_YEARN_YVWETH = "0xa258C4606Ca8206D8aA700cE2143D7db854D168c"
LIVE_YEARN_YVDAI = "0xdA816459F1AB5631232FE5e97a05BBBb94970c95"
LIVE_RSWETH = "0xFAe1031830626743d967e01CFD7709F74CDCB7dA"
LIVE_FX_ERC20_TUNNEL = "0x0cc2caed31490b546c741bd93dbba8ab387f7f2c"
LIVE_FX_ROOT = "0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2"
LIVE_SCROLL_WETH_GW = "0x7AC440cAe8EB6328de4fA621163a792c1EA9D4fE"
LIVE_CURVE_3POOL_GAUGE = "0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A"
LIVE_AURA_BOOSTER = "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234"
LIVE_SPARK_POOL = "0xC13e21B648A5Ee794902342038FF3aDAB66BE987"
LIVE_LIQUITY_TROVE = "0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2"
LIVE_USDS = "0xdC035D45d973E3EC169d2276DDab16f1e407384F"
LIVE_SUSDS = "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD"
LIVE_FLUID_LIQ = "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497"
LIVE_FLUID_DUMMY = "0xcc331daf69752bece3dc98dbc63eacd5092266a2"
LIVE_LIDO_WQ = "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"
LIVE_ROCKET_DP = "0x2cac916b2A963Bf162f076C0a8a4a8200BCFBfb4"
LIVE_RENZO_RM = "0x74a09653A083691711cF8215a6ab074BB4e99ef5"
LIVE_LIQUITY_BO = "0x24179CD81c9e782A4096035f7eC97fB8B783e007"
LIVE_MAKER_POT = "0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7"
LIVE_SPARK_WETH_GW = "0xBD7D6a9ad7865463DE44B05F04559f65e3B11704"
LIVE_DAI_JOIN = "0x9759A6Ac90977b93B58547b4A71c78317f391A28"
LIVE_ETH_JOIN = "0x2F0b23f53734252Bda2277357e97e1517d6B042A"
LIVE_LITE_PSM = "0xf6e72Db5454dd049d0788e411b06CfAF16853042"
LIVE_DSR_MANAGER = "0x373238337Bfe1146fb49989fc222523f83081dDb"
LIVE_GEARBOX_CM = "0x3EB95430FdB99439A86d3c6D7D01C3c561393556"
LIVE_COW_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
LIVE_FRXETH = "0x5E8422345238F34275888049021821E8E08Caa1f"
LIVE_UNI_V4_PM = "0x000000000004444c5dc75cB358380D2e3dE08A90"
LIVE_USDS_JOIN = "0x3C0f895007CA717Aa01c8693e59DF1e8C3777FEB"
LIVE_DAI_USDS = "0x3225737a9Bbb6473CB4A45b7244ACa2BeFdB276A"
LIVE_EULER_EVAULT = "0x8Ff1C814719096b61aBf00Bb46EAd0c9A529Dd7D"
LIVE_GEARBOX_POOL = "0xda00000035fef4082F78dEF6A8903bee419FbF8E"
LIVE_CRVUSD_CTRL = "0x4e59541306910aD6dC1daC0AC9dFB29bD9F15c67"
LIVE_CRVUSD_LLAMMA_IMPL = "0x2B7e624bdb839975d56D8428d9f6A4cf1160D3e9"
LIVE_CONTANGO_VAULT = "0x3F37C7d8e61C000085AAc0515775b06A3412F36b"
LIVE_COMET_REWARDS = "0x1B0e765F6224C21223AeA2af16c1C46E38885a40"
LIVE_AAVE_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e"
LIVE_USDE = "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3"
LIVE_SUSDE = "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497"
LIVE_SFRXETH = "0xac3E018457B222d93114458476f3E3416Abbe38F"
LIVE_BALANCER_V2 = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
LIVE_COMET_USDC = "0xc3d688B66703497DAA19211EEdff47f25384cdc3"
LIVE_COMET_USDC_IMPL = "0x63e749153BaF1838f63cA22c275370BD2B1cEB15"
LIVE_AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
LIVE_AAVE_V3_POOL_IMPL = "0x728a138A4823392C2EFA55e028d434F526fE03CF"
LIVE_EULER_USDC_PROXY = "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9"
LIVE_LQ2_TM_WETH = "0x7bcb64b2c9206a5b699ed43363f6f98d4776cf5a"
LIVE_LQ2_SP_WETH = "0x5721cbbd64fc7ae3ef44a0a3f9a790a9264cf9bf"
LIVE_BOLD = "0x6440f144b7e50D6a8439336510312d2F54beB01D"
LIVE_YEARN_V3_VAULT = "0xc1F484Dee9a586c122D658B8AFE3436c2F4290be"
LIVE_PUFFER_VAULT = "0x3b2fdFdEFE919dBcCE0bc5ac426097d5523B8AFA"
LIVE_ACROSS_SPOKE = "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5"
LIVE_EIGEN_POD_MGR = "0x91E677b07F7AF907ec9a428aafA9fc14a0d3A338"
LIVE_LQ2_TM_WSTETH = "0xA2895d6A3bf110561Dfe4b71cA539d84e1928B22"
LIVE_LQ2_SP_WSTETH = "0x9502b7c397e9aa22fe9db7ef7daf21cd2aebe56b"
LIVE_LQ2_TM_RETH = "0xb2B2ABEb5C357a234363FF5D180912D319e3e19e"
LIVE_LQ2_SP_RETH = "0xd442e41019b7f5c4dd78f50dc03726c446148695"
LIVE_SYRUP_USDC = "0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b"
LIVE_SYRUP_USDT = "0x356B8d89c1e1239Cbbb9dE4815c39A1474d5BA7D"
LIVE_SYRUP_ROUTER = "0x134cCaaA4F1e4552eC8aEcb9E4A2360dDcF8df76"
LIVE_STARGATE_USDC = "0xc026395860Db2d07ee33e05fE50ed7bD583189C7"
LIVE_STARGATE_NATIVE = "0x77b2043768d28E9C9aB44E1aBfC95944bcE57931"
LIVE_STARGATE_MSG = "0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980"
LIVE_ENZYME_VAULTLIB = "0x891dee0483eBAA922E274ddD2eBBaA2D33468A38"
LIVE_OETH_VAULT_IMPL = "0x0E979edF516f88119fa2843fA3f08A9643F8e575"
LIVE_PENDLE_SY_STETH = "0xcbC72d92b2dc8187414F6734718563898740C0BC"
LIVE_CONVEX_CVXCRV = "0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e"
LIVE_ETHENA_MINT = "0xe3490297a08d6fC8Da46Edb7B6142E4F461b62D3"
LIVE_ETHERFI_LP = "0x308861A430be4cce5502d0A12724771Fc6DaF216"
LIVE_ETHERFI_LP_IMPL = "0x17A16747D03006c9754548AC0d0afF48783A4a45"
LIVE_TREEHOUSE_ROUTER = "0xeFA3fa8e85D2b3CfdB250CdeA156c2c6C90628F5"
LIVE_DAO_COLLATERAL = "0xde6e1F680C4816446C8D515989E2358636A38b04"
LIVE_EUSD = "0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F"
LIVE_TETH_VAULT = "0x551d155760ae96050439AD24Ae98A96c765d761B"
LIVE_TETH_TOKEN = "0xD11c452fc99cF405034ee446803b6F6c1F6d5ED8"
LIVE_USD0 = "0x73A15FeD60Bf67631dC6cd7Bc5B6e8da8190aCF5"
LIVE_USD0PP = "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0"
LIVE_STAKED_LBTC = "0x8236A87084F8B84306F72007F36F2618A5634494"
LIVE_ETHERFI_WRNFT = "0x7d5706f6ef3F89B3951E23e557CDFBC3239D4E2c"
LIVE_FOLIO_DEPLOYER = "0x4D201a6e5BF975E2CEE9e5cbDfc803C0Ff122073"
LIVE_FOLIO_IMPL = "0xb6b35b2c7032E00BAa2535Ba480d461321B7E0A6"
LIVE_TETH_CCIP = "0x8113f001eA456759264317007220cBc939cA8435"
LIVE_EUSD_BM = "0xF014FEF41cCB703975827C8569a3f0940cFD80A4"
LIVE_EUSD_BM_IMPL = "0x62A574b9F4BCc1DDf877E154963C5B4E792985d6"
LIVE_MANTLE_STAKING = "0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f"
LIVE_MANTLE_URM = "0x38fDF7b489316e03eD8754ad339cb5c4483FDcf9"
LIVE_TETH_REDEEM = "0x62fb2022c4be4586432f298de9a404da92d9dd90"
LIVE_FLUID_VAULT_T1 = "0x348aD11DB2c90e7FdF8e57420C569F76dBe38a59"
LIVE_FRAXLEND_SFRXETH = "0x78bB3aEC3d855431bd9289fD98dA13F9ebB7ef15"
LIVE_SOMMELIER_CELLAR_IMPL = "0x99bA1Ef93A5ef0596Bb14B45e9D313eD5969bfe6"
LIVE_TERM_CM = "0xb99F5a082465b4cD8037E28Ac7e0BF81B609Df53"
LIVE_TERM_LOCKER = "0xFCf4eF17D1BC11dF6c6200A809C54cB06F16e86e"
LIVE_LSETH = "0x8c1BEd5b9a0928467c9B1341Da1D7BD5e10b6549"
LIVE_LSETH_IMPL = "0x0056f9ed62dAa4dc3F972340C92326AcCddd1a9D"
LIVE_CONTANGO_IMPL = "0x3cab97F99147012B0B1352E5E1278c933776861a"
LIVE_GOLDFINCH_SENIOR_IMPL = "0x656cC68D76C7DEA07b477fFD26f6C9766d154e5E"
LIVE_SCRVUSD = "0x0655977FEb2f289A4aB78af67BAB0d17aAb84367"
LIVE_VEDA_BORING = "0xf0bb20865277aBd641a307eCe5Ee04E79073416C"
LIVE_VEDA_TELLER = "0x9AA79C84b79816ab920bBcE20f8f74557B514734"
LIVE_VEDA_QUEUE = "0x0D2dF071207E18Ca8638b4f04E98c53155eC2cE0"
LIVE_UPSHIFT_VAULT = "0x3EAa4b3e8967c02cE1304C1EB35e8C5409838DFC"
LIVE_MELLOW_VAULT = "0x76001faFd4a8d3E8Cd399e19B91296Bc8bD0bb84"
LIVE_CLEARPOOL_IMPL = "0x2E1CE0F2ab6B61d5A3d1682a77496c4611860B57"
LIVE_CLEARPOOL_WINTERMUTE = "0xcb288b6d30738db7e3998159d192615769794b5b"
LIVE_UPSHIFT_POOL_IMPL = "0xc0026E559dA7F2d4eE573616C09A8F721fa599bd"
LIVE_MELLOW_ROOT_VAULT = "0xa1eeEb677a121327Ea2643Fb47a23fec304Edd00"
LIVE_CONCRETE_WSTETH = "0xd57588c73715b65e0ead36ae06c15644169501b7"
LIVE_CONCRETE_WSTETH_IMPL = "0x438d1eb241F866A91EbD0cc148FDa9ac9b09093E"
LIVE_CONCRETE_DELTA_WEETH = "0xb9dc54c8261745cb97070cefbe3d3d815aee8f20"


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
        self.assertTrue(name_is_fund_mover("receiveMessage"))
        self.assertTrue(name_is_fund_mover("proposeRootBundle"))
        self.assertTrue(name_is_fund_mover("executeRootBundle"))
        self.assertTrue(name_is_fund_mover("disputeRootBundle"))
        self.assertTrue(name_is_fund_mover("sendToL2"))
        self.assertTrue(name_is_fund_mover("bondWithdrawal"))
        self.assertTrue(name_is_fund_mover("depositTransaction"))
        self.assertTrue(name_is_fund_mover("finalizeWithdrawalTransaction"))
        self.assertTrue(name_is_fund_mover("proveWithdrawalTransaction"))
        self.assertTrue(name_is_fund_mover("createRetryableTicket"))
        self.assertTrue(name_is_fund_mover("finalizeETHWithdrawal"))
        self.assertTrue(name_is_fund_mover("bridgeETH"))
        self.assertTrue(name_is_fund_mover("lockTokens"))
        self.assertTrue(name_is_fund_mover("exitTokens"))
        self.assertTrue(name_is_fund_mover("finalizeWithdrawETH"))
        self.assertTrue(name_is_fund_mover("depositWithMessage"))
        self.assertTrue(name_is_fund_mover("requestL2Transaction"))
        self.assertTrue(name_is_fund_mover("relayMessageWithProof"))
        self.assertTrue(name_is_fund_mover("depositEther"))
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
        self.assertTrue(_ident_match("VaultV3", "Vault"))
        self.assertTrue(_ident_match("TokenImpl", "Token"))
        self.assertTrue(_ident_match("FooFacet", "Foo"))
        self.assertTrue(_ident_match("HubPoolInterface", "HubPool"))
        self.assertTrue(_ident_match("FiatTokenV2_2", "FiatTokenV2"))
        self.assertTrue(_ident_match("PendleMarketV3", "PendleMarket"))
        self.assertFalse(_ident_match("Morpho", "MetaMorpho"))
        self.assertFalse(_ident_match("MetaMorpho", "Morpho"))
        self.assertFalse(_ident_match("LendingPool", "Pool"))
        self.assertFalse(_ident_match("YearnVault", "Vault"))
        # yVault vs Vault is intentionally NOT aliased (Yearn Etherscan name).
        self.assertFalse(_ident_match("yVault", "Vault"))
        self.assertFalse(_ident_match("Vault", "yVault"))
        self.assertFalse(_ident_match("Dai", "Vat"))

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
        self.assertEqual(_ADDR["pendle_market_like.sol"], LIVE_PENDLE_MARKET)

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


class Pass7LiveLocks(unittest.TestCase):
    """Pass 7: Pendle market lock, aliases, Yearn getter, Hub movers, diamond, GMX token."""

    def test_live_pendle_market_json_is_pool_not_vault(self):
        src = (FIXTURES / "pendle_market_live_shape.json").read_text(encoding="utf-8")
        from eth_scanner.ingest.unpack import flatten_sources, parse_etherscan_sources
        flat = flatten_sources(parse_etherscan_sources(src))
        ir = normalize(_art(src, contract_name="PendleMarket"), try_slither=False)
        self.assertEqual(ir.contract_class, "pool")
        self.assertNotEqual(ir.contract_class, "vault")
        self.assertNotEqual(ir.contract_class, "router")
        d = classify_scope(
            source=flat,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="PendleMarket",
        )
        self.assertEqual(d.contract_class, "pool")
        self.assertEqual(d.scope, "in-scope")
        self.assertIn("pendle-market", d.signals)
        self.assertNotEqual(d.contract_class, "vault")
        r = _lane("pendle_market_live_shape.json", tvl=4_900_000)
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"swapExactPtForSy", "swapSyForExactPt", "mint", "burn"})

    def test_yearn_public_getter_tags_yearn_share_price(self):
        src = (FIXTURES / "yearn_v2_public_getter_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="yVault"), try_slither=False)
        d = classify_scope(
            source=src,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="yVault",
        )
        self.assertEqual(d.contract_class, "vault")
        self.assertIn("yearn-share-price", d.signals)
        self.assertNotIn("share-accounting", d.signals)
        r = _lane("yearn_v2_public_getter_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_across_hub_movers_include_bundle_verbs(self):
        r = _lane("across_hub_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"addLiquidity", "removeLiquidity"})
        self.assertTrue(set(r.value_movers) & {"proposeRootBundle", "executeRootBundle"})
        self.assertGreaterEqual(len(r.value_movers), 3)

    def test_comment_contract_is_not_a_type(self):
        from eth_scanner.heuristics.scope import _type_blocks
        src = (FIXTURES / "across_hub_like.sol").read_text(encoding="utf-8")
        names = [n for _k, n, _b in _type_blocks(src)]
        self.assertIn("HubPool", names)
        self.assertIn("Ethereum_Adapter", names)
        self.assertNotIn("is", names)
        self.assertNotIn("via", names)
        self.assertNotIn("the", names)

    def test_gmx_token_is_not_a_vault(self):
        r = _lane("gmx_token_like.sol", tvl=50_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "vault")
        src = (FIXTURES / "gmx_token_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="GMX"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertNotEqual(ir.contract_class, "vault")

    def test_gmx_glp_shape_still_vault(self):
        r = _lane("gmx_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_diamond_thin_primary_keeps_vault_facet(self):
        src = (FIXTURES / "diamond_thin_primary_like.json").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Diamond"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertEqual(ir.scope, "in-scope")
        movers = {fn.name.lower() for fn in ir.functions if fn.is_value_mover and fn.exposed}
        self.assertTrue(movers & {"deposit", "withdraw"})

    def test_inherited_lib_keeps_primary_and_drops_sibling(self):
        src = (FIXTURES / "inherited_lib_movers_like.json").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="VaultV3"), try_slither=False)
        movers = {fn.name.lower() for fn in ir.functions if fn.is_value_mover and fn.exposed}
        self.assertIn("deposit", movers)
        self.assertNotIn("borrow", movers)
        self.assertNotIn("liquidate", movers)
        self.assertEqual(ir.contract_class, "vault")
        self.assertNotEqual(ir.contract_class, "lending")

    def test_known_live_set_before_after_lock(self):
        """Re-scan the known live fixture set. Buckets, never verdicts."""
        expected = {
            "usdc_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "weth_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "wsteth_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "uni_v3_router_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "uni_v2_router_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "pendle_router_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "uni_v3_pool_live_shape.sol": ("pool", "in-scope", "lane-b-queue"),
            "aave_v3_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "morpho_blue_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "metamorpho_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "compound_comet_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "across_spoke_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "across_hub_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "across_hub_adapter_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "eigen_delegation_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "convex_booster_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "pendle_market_live_shape.json": ("pool", "in-scope", "lane-b-queue"),
            "yearn_v2_public_getter_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "gmx_token_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "gmx_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "maker_vat_like.sol": ("maker", "in-scope", "lane-b-queue"),
            "yearn_yvusdc_vyper_live_shape.vy": ("vault", "in-scope", "lane-b-queue"),
            "across_hub_live_shape.json": ("bridge", "in-scope", "lane-b-queue"),
            "pendle_router_v4_live_shape.json": ("router", "demoted-passthrough", "lane-a-cool"),
            "dai_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "weeth_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "eeth_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "sdai_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "diamond_router_like.json": ("router", "demoted-passthrough", "lane-a-cool"),
            "rseth_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "rseth_wrap_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "ezeth_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "ezeth_wrap_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "cbeth_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "cbeth_wrap_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "kelp_deposit_pool_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "hop_l1_eth_bridge_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "optimism_portal_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "op_standard_bridge_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "arbitrum_inbox_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "yearn_yvusdc_etherscan_live_shape.vy": ("vault", "in-scope", "lane-b-queue"),
            "hop_l1_erc20_bridge_live_shape.sol": ("bridge", "in-scope", "lane-b-queue"),
            "optimism_portal2_impl_live_shape.sol": ("bridge", "in-scope", "lane-b-queue"),
            "l1_standard_bridge_impl_live_shape.sol": ("bridge", "in-scope", "lane-b-queue"),
            "arb_inbox_impl_live_shape.sol": ("bridge", "in-scope", "lane-b-queue"),
            "polygon_ether_predicate_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "polygon_erc20_predicate_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "polygon_deposit_manager_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "scroll_l1_eth_gateway_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "scroll_l1_messenger_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "starknet_eth_bridge_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "zksync_mailbox_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "zksync_l1_erc20_bridge_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "sweth_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "meth_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "reth_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "woeth_wrap_like.sol": ("wrap-token", "demoted-token", "lane-a-cool"),
            "yearn_yvweth_etherscan_live_shape.vy": ("vault", "in-scope", "lane-b-queue"),
            "yearn_yvdai_etherscan_live_shape.vy": ("vault", "in-scope", "lane-b-queue"),
            "rsweth_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "fx_erc20_root_tunnel_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "fx_root_like.sol": ("utility", "utility", "human-no-candidate"),
            "scroll_l1_weth_gateway_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "curve_gauge_like.vy": ("staking", "in-scope", "lane-b-queue"),
            "aura_booster_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "spark_pool_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "liquity_trove_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "usds_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "susds_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "fluid_liquidity_dummy_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "lido_withdrawal_queue_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "rocket_deposit_pool_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "renzo_restake_manager_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "liquity_borrower_ops_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "maker_pot_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "weth_gateway_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "dai_join_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "gem_join_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "dss_lite_psm_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "dsr_manager_like.sol": ("custody", "in-scope", "lane-b-queue"),
            "gearbox_credit_manager_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "cow_settlement_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "frxeth_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "uni_v4_pool_manager_like.sol": ("pool", "in-scope", "lane-b-queue"),
            "usds_join_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "dai_usds_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "euler_evault_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "gearbox_pool_v3_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "crvusd_controller_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "crvusd_llamma_like.vy": ("pool", "in-scope", "lane-b-queue"),
            "contango_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "comet_rewards_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "pool_addresses_provider_like.sol": ("utility", "utility", "human-no-candidate"),
            "usde_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "susde_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "sfrxeth_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "liquity_v2_trove_like.sol": ("lending", "in-scope", "lane-b-queue"),
            "liquity_v2_stability_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "bold_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "yearn_v3_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "puffer_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "maple_pool_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "maple_syrup_router_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "stargate_pool_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "stargate_token_messaging_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "enzyme_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "origin_oeth_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "etherfi_liquidity_pool_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "treehouse_router_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "usual_dao_collateral_like.sol": ("router", "demoted-passthrough", "lane-a-cool"),
            "rtoken_like.sol": ("token", "demoted-token", "lane-a-cool"),
            "teth_vault_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "teth_tasset_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "usd0pp_like.sol": ("custody", "in-scope", "lane-b-queue"),
            "folio_deployer_like.sol": ("utility", "utility", "human-no-candidate"),
            "folio_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "ccip_lock_release_like.sol": ("bridge", "in-scope", "lane-b-queue"),
            "reserve_backing_manager_like.sol": ("vault", "in-scope", "lane-b-queue"),
            "mantle_unstake_queue_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "mantle_staking_like.sol": ("staking", "in-scope", "lane-b-queue"),
            "treehouse_redemption_like.sol": ("vault", "in-scope", "lane-b-queue"),
        }
        for name, (klass, scope, bucket) in expected.items():
            r = _lane(name)
            self.assertEqual((r.contract_class, r.scope, r.bucket), (klass, scope, bucket), name)


class Pass8LiveLocks(unittest.TestCase):
    """Pass 8: live Yearn Vyper, Across HubPool file movers, diamonds, DAI/weETH."""

    def test_yearn_vyper_live_shape_is_yearn_share_price(self):
        src = (FIXTURES / "yearn_yvusdc_vyper_live_shape.vy").read_text(encoding="utf-8")
        ir = normalize(_art(src, language="vyper", contract_name="yVault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        d = classify_scope(
            source=src,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="yVault",
        )
        self.assertEqual(d.contract_class, "vault")
        self.assertEqual(d.scope, "in-scope")
        self.assertIn("yearn-share-price", d.signals)
        self.assertNotIn("share-accounting", d.signals)
        r = _lane("yearn_yvusdc_vyper_live_shape.vy")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["yearn_yvusdc_vyper_live_shape.vy"], LIVE_YEARN_YVUSDC)
        self.assertTrue(set(r.value_movers) & {"deposit", "withdraw"})

    def test_yearn_vyper_public_getter_tags_yearn_share_price(self):
        src = (FIXTURES / "yearn_vyper_public_getter_like.vy").read_text(encoding="utf-8")
        ir = normalize(_art(src, language="vyper", contract_name="yVault"), try_slither=False)
        d = classify_scope(
            source=src,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="yVault",
        )
        self.assertEqual(d.contract_class, "vault")
        self.assertIn("yearn-share-price", d.signals)
        self.assertNotIn("share-accounting", d.signals)

    def test_across_hub_sourcify_live_shape_hubpool_file_movers(self):
        src = (FIXTURES / "across_hub_live_shape.json").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="HubPool"), try_slither=False)
        self.assertEqual(ir.contract_class, "bridge")
        movers = {fn.name for fn in ir.functions if fn.is_value_mover and fn.exposed}
        self.assertTrue(movers & {"addLiquidity", "removeLiquidity"})
        self.assertTrue(movers & {"proposeRootBundle", "executeRootBundle", "disputeRootBundle"})
        hub_files = {fn.file.replace("\\", "/") for fn in ir.functions if fn.name in movers}
        self.assertTrue(any(p.endswith("HubPool.sol") for p in hub_files))
        self.assertFalse(any("relayTokens" == n for n in movers))
        r = _lane("across_hub_live_shape.json")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["across_hub_live_shape.json"], LIVE_ACROSS_HUB)
        self.assertTrue(set(r.value_movers) & {"addLiquidity", "proposeRootBundle", "executeRootBundle"})

    def test_pendle_router_v4_thin_diamond_cools(self):
        src = (FIXTURES / "pendle_router_v4_live_shape.json").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="PendleRouterV4"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertEqual(ir.scope, "demoted-passthrough")
        r = _lane("pendle_router_v4_live_shape.json", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["pendle_router_v4_live_shape.json"], LIVE_PENDLE_ROUTER)

    def test_diamond_router_facet_still_cools(self):
        src = (FIXTURES / "diamond_router_like.json").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Diamond"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertEqual(ir.scope, "demoted-passthrough")
        r = _lane("diamond_router_like.json", tvl=50_000)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_diamond_loupe_only_is_false_keep(self):
        src = (FIXTURES / "diamond_loupe_only_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Diamond"), try_slither=False)
        self.assertEqual(ir.contract_class, "custody")
        self.assertEqual(ir.scope, "in-scope")
        self.assertIn("diamond-facets-missing", ir.scope_signals)
        r = _lane("diamond_loupe_only_like.sol")
        self.assertEqual(r.scope, "in-scope")
        self.assertNotEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.bucket, "human-no-candidate")
        self.assertIn(r.bucket, {"lane-b-queue", "manual-review"})

    def test_dai_is_token_not_maker(self):
        r = _lane("dai_like.sol", tvl=5_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "maker")
        self.assertNotEqual(r.bucket, "lane-b-queue")
        src = (FIXTURES / "dai_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Dai"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertIn("dss-token", ir.scope_signals)
        self.assertEqual(_ADDR["dai_like.sol"], LIVE_DAI)

    def test_weeth_is_wrap_token_not_custody(self):
        r = _lane("weeth_like.sol", tvl=3_000_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["weeth_like.sol"], LIVE_WEETH)

    def test_eeth_share_token_is_token_not_staking(self):
        r = _lane("eeth_like.sol", tvl=3_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["eeth_like.sol"], LIVE_EETH)

    def test_sdai_stays_vault(self):
        r = _lane("sdai_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["sdai_like.sol"], LIVE_SDAI)

    def test_maker_vat_still_maker_after_dai_fix(self):
        r = _lane("maker_vat_like.sol")
        self.assertEqual(r.contract_class, "maker")
        self.assertEqual(r.bucket, "lane-b-queue")


class Pass9ShareWrapsAndLockRelease(unittest.TestCase):
    """Pass 9: rsETH/ezETH/cbETH share-wraps + Hop/OP/Arbitrum lock-release."""

    def test_rseth_token_is_token_not_staking(self):
        r = _lane("rseth_like.sol", tvl=2_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertEqual(_ADDR["rseth_like.sol"], LIVE_RSETH)

    def test_rseth_wrap_is_wrap_token_not_custody(self):
        r = _lane("rseth_wrap_like.sol", tvl=2_000_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "custody")
        src = (FIXTURES / "rseth_wrap_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="WrsETH"), try_slither=False)
        self.assertIn("share-wrap", ir.scope_signals)

    def test_rseth_tree_primary_stays_token(self):
        src = (FIXTURES / "rseth_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RSETH"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertNotEqual(ir.contract_class, "staking")
        d = classify_scope(
            source=src,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="RSETH",
        )
        self.assertEqual(d.contract_class, "token")
        self.assertEqual(d.scope, "demoted-token")

    def test_kelp_deposit_pool_is_staking(self):
        r = _lane("kelp_deposit_pool_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        src = (FIXTURES / "kelp_deposit_pool_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="LRTDepositPool"), try_slither=False)
        self.assertIn("lrt-deposit-pool", ir.scope_signals)

    def test_ezeth_token_is_token_not_staking(self):
        r = _lane("ezeth_like.sol", tvl=2_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["ezeth_like.sol"], LIVE_EZETH)

    def test_ezeth_wrap_is_wrap_token_not_custody(self):
        r = _lane("ezeth_wrap_like.sol", tvl=2_000_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "custody")

    def test_ezeth_tree_primary_stays_token(self):
        src = (FIXTURES / "ezeth_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="EzEthToken"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertNotEqual(ir.contract_class, "staking")

    def test_cbeth_is_wrap_token_not_vault(self):
        r = _lane("cbeth_like.sol", tvl=5_000_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "vault")
        self.assertNotEqual(r.contract_class, "custody")
        src = (FIXTURES / "cbeth_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="StakedTokenV1"), try_slither=False)
        self.assertIn("share-wrap", ir.scope_signals)
        self.assertEqual(_ADDR["cbeth_like.sol"], LIVE_CBETH)

    def test_cbeth_wrap_is_wrap_token(self):
        r = _lane("cbeth_wrap_like.sol", tvl=1_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_usdc_still_token_not_cbeth_wrap(self):
        r = _lane("usdc_like.sol", tvl=30_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertNotEqual(r.contract_class, "wrap-token")

    def test_hop_is_bridge_not_staking(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertTrue(set(r.value_movers) & {"sendToL2", "bondWithdrawal", "withdraw"})
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_optimism_portal_is_bridge_not_custody(self):
        r = _lane("optimism_portal_like.sol", tvl=200_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertTrue(set(r.value_movers) & {
            "depositTransaction", "finalizeWithdrawalTransaction", "proveWithdrawalTransaction",
        })
        self.assertEqual(_ADDR["optimism_portal_like.sol"], LIVE_OP_PORTAL)

    def test_op_standard_bridge_is_bridge(self):
        r = _lane("op_standard_bridge_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"finalizeETHWithdrawal", "bridgeETH", "depositERC20"})
        self.assertEqual(_ADDR["op_standard_bridge_like.sol"], LIVE_OP_STD_BRIDGE)

    def test_arbitrum_inbox_is_bridge(self):
        r = _lane("arbitrum_inbox_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"createRetryableTicket", "depositEth"})
        self.assertEqual(_ADDR["arbitrum_inbox_like.sol"], LIVE_ARB_INBOX)

    def test_yearn_etherscan_vyper_contract_name_is_vault(self):
        src = (FIXTURES / "yearn_yvusdc_etherscan_live_shape.vy").read_text(encoding="utf-8")
        ir = normalize(_art(src, language="vyper", contract_name="Vyper_contract"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        d = classify_scope(
            source=src,
            functions=ir.functions,
            extra_names=ir.function_names,
            contract_name="Vyper_contract",
        )
        self.assertEqual(d.contract_class, "vault")
        self.assertEqual(d.scope, "in-scope")
        self.assertIn("yearn-share-price", d.signals)
        r = _lane("yearn_yvusdc_etherscan_live_shape.vy")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["yearn_yvusdc_etherscan_live_shape.vy"], LIVE_YEARN_YVUSDC)
        self.assertTrue(set(r.value_movers) & {"deposit", "withdraw"})


class Pass10LockReleaseImplsAndLsts(unittest.TestCase):
    """Pass 10: impl pins, more lock-release, LST false-bridge, Yearn Vyper_contract."""

    def test_hop_l1_eth_still_unverified_erc20_is_live_bridge(self):
        r = _lane("hop_l1_erc20_bridge_live_shape.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertTrue(set(r.value_movers) & {"sendToL2", "bondWithdrawal", "stake"})
        self.assertEqual(_ADDR["hop_l1_erc20_bridge_live_shape.sol"], LIVE_HOP_ERC20)
        eth = _lane("hop_l1_eth_bridge_like.sol")
        self.assertEqual(eth.contract_class, "bridge")

    def test_op_portal_impl_is_bridge(self):
        r = _lane("optimism_portal2_impl_live_shape.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {
            "depositTransaction", "finalizeWithdrawalTransaction", "proveWithdrawalTransaction",
        })
        self.assertEqual(_ADDR["optimism_portal2_impl_live_shape.sol"], LIVE_OP_PORTAL_IMPL)

    def test_op_std_bridge_impl_is_bridge(self):
        r = _lane("l1_standard_bridge_impl_live_shape.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["l1_standard_bridge_impl_live_shape.sol"], LIVE_OP_STD_BRIDGE_IMPL)

    def test_arb_inbox_impl_is_bridge(self):
        r = _lane("arb_inbox_impl_live_shape.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"createRetryableTicket", "depositEth"})
        self.assertEqual(_ADDR["arb_inbox_impl_live_shape.sol"], LIVE_ARB_INBOX_IMPL)

    def test_polygon_ether_predicate_is_bridge_not_custody(self):
        r = _lane("polygon_ether_predicate_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertTrue(set(r.value_movers) & {"lockTokens", "exitTokens"})
        self.assertEqual(_ADDR["polygon_ether_predicate_like.sol"], LIVE_POLY_ETHER_PRED)

    def test_polygon_erc20_predicate_is_bridge(self):
        r = _lane("polygon_erc20_predicate_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_polygon_deposit_manager_is_bridge_not_staking(self):
        src = (FIXTURES / "polygon_deposit_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DepositManager"), try_slither=False)
        self.assertEqual(ir.contract_class, "bridge")
        self.assertNotEqual(ir.contract_class, "staking")
        r = _lane("polygon_deposit_manager_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"depositEther", "depositERC20"})

    def test_scroll_l1_eth_gateway_is_bridge(self):
        r = _lane("scroll_l1_eth_gateway_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"finalizeWithdrawETH", "depositETH"})
        self.assertEqual(_ADDR["scroll_l1_eth_gateway_like.sol"], LIVE_SCROLL_ETH_GW)

    def test_scroll_l1_messenger_is_bridge(self):
        r = _lane("scroll_l1_messenger_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"relayMessageWithProof", "replayMessage"})

    def test_starknet_eth_bridge_is_bridge_not_custody(self):
        r = _lane("starknet_eth_bridge_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertTrue(set(r.value_movers) & {"depositWithMessage", "withdraw", "deposit"})
        self.assertEqual(_ADDR["starknet_eth_bridge_like.sol"], LIVE_STARKNET_ETH)

    def test_zksync_mailbox_is_bridge(self):
        r = _lane("zksync_mailbox_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"requestL2Transaction", "finalizeEthWithdrawal"})
        self.assertEqual(_ADDR["zksync_mailbox_like.sol"], LIVE_ZKSYNC_DIAMOND)

    def test_zksync_l1_erc20_bridge_finalize_withdrawal_is_bridge(self):
        r = _lane("zksync_l1_erc20_bridge_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"finalizeWithdrawal", "deposit"})

    def test_sweth_is_staking_not_bridge(self):
        r = _lane("sweth_like.sol", tvl=500_000_000)
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["sweth_like.sol"], LIVE_SWETH)

    def test_sweth_tree_finalize_withdrawal_iface_is_not_bridge(self):
        src = (FIXTURES / "sweth_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="swETH"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertNotEqual(ir.contract_class, "bridge")
        self.assertIn("swell-lst", ir.scope_signals)

    def test_meth_is_token_not_staking(self):
        r = _lane("meth_like.sol", tvl=1_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["meth_like.sol"], LIVE_METH)

    def test_meth_tree_sibling_stake_does_not_promote(self):
        src = (FIXTURES / "meth_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="METH"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertNotEqual(ir.contract_class, "staking")
        self.assertNotEqual(ir.contract_class, "wrap-token")

    def test_reth_is_staking_not_wrap(self):
        r = _lane("reth_like.sol", tvl=2_000_000_000)
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "wrap-token")
        self.assertNotEqual(r.contract_class, "token")
        src = (FIXTURES / "reth_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RocketTokenRETH"), try_slither=False)
        self.assertIn("rocket-reth", ir.scope_signals)
        self.assertEqual(_ADDR["reth_like.sol"], LIVE_RETH)

    def test_woeth_wrap_is_wrap_token(self):
        r = _lane("woeth_wrap_like.sol", tvl=100_000_000)
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertNotEqual(r.contract_class, "custody")

    def test_yearn_yvweth_vyper_contract_is_vault(self):
        src = (FIXTURES / "yearn_yvweth_etherscan_live_shape.vy").read_text(encoding="utf-8")
        ir = normalize(_art(src, language="vyper", contract_name="Vyper_contract"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        r = _lane("yearn_yvweth_etherscan_live_shape.vy")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["yearn_yvweth_etherscan_live_shape.vy"], LIVE_YEARN_YVWETH)

    def test_yearn_yvdai_vyper_contract_is_vault(self):
        r = _lane("yearn_yvdai_etherscan_live_shape.vy")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["yearn_yvdai_etherscan_live_shape.vy"], LIVE_YEARN_YVDAI)

    def test_force_mint_is_token_admin(self):
        from eth_scanner.heuristics.scope import _is_token_admin
        self.assertTrue(_is_token_admin("forceMint"))
        self.assertTrue(_is_token_admin("forceBurn"))
        self.assertFalse(_is_token_admin("depositExcess"))


class Pass11SiblingLeaksAndVenues(unittest.TestCase):
    """Pass 11: eigen/wrap sibling leaks, FxPortal, gauges, live venue pins."""

    def test_hop_l1_eth_still_unverified_keeps_shape(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertNotEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_rsweth_is_swell_lst_not_eigenlayer(self):
        r = _lane("rsweth_like.sol", tvl=400_000_000)
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "token")
        self.assertEqual(_ADDR["rsweth_like.sol"], LIVE_RSWETH)
        src = (FIXTURES / "rsweth_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RswETH"), try_slither=False)
        self.assertIn("swell-lst", ir.scope_signals)
        self.assertNotIn("eigenlayer", ir.scope_signals)

    def test_rsweth_tree_eigen_iface_does_not_steal_family(self):
        src = (FIXTURES / "rsweth_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RswETH"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertIn("swell-lst", ir.scope_signals)
        self.assertNotIn("eigenlayer", ir.scope_signals)

    def test_meth_tree_sibling_weth_shape_stays_token(self):
        src = (FIXTURES / "meth_tree_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="METH"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertEqual(ir.scope, "demoted-token")
        self.assertNotEqual(ir.contract_class, "wrap-token")
        self.assertNotEqual(ir.contract_class, "staking")

    def test_fx_erc20_root_tunnel_is_bridge_not_custody(self):
        r = _lane("fx_erc20_root_tunnel_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertTrue(set(r.value_movers) & {"deposit", "receiveMessage"})
        self.assertEqual(_ADDR["fx_erc20_root_tunnel_like.sol"], LIVE_FX_ERC20_TUNNEL)

    def test_fx_root_messaging_is_utility(self):
        r = _lane("fx_root_like.sol")
        self.assertEqual(r.contract_class, "utility")
        self.assertEqual(r.scope, "utility")
        self.assertNotEqual(r.contract_class, "bridge")
        self.assertIn(r.bucket, {"lane-a-cool", "human-no-candidate"})
        self.assertEqual(_ADDR["fx_root_like.sol"], LIVE_FX_ROOT)

    def test_scroll_l1_weth_gateway_is_bridge(self):
        r = _lane("scroll_l1_weth_gateway_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"finalizeWithdrawERC20", "depositERC20"})
        self.assertEqual(_ADDR["scroll_l1_weth_gateway_like.sol"], LIVE_SCROLL_WETH_GW)

    def test_curve_gauge_is_staking_not_custody(self):
        src = (FIXTURES / "curve_gauge_like.vy").read_text(encoding="utf-8")
        ir = normalize(_art(src, language="vyper", contract_name="Vyper_contract"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertIn("curve-gauge", ir.scope_signals)
        r = _lane("curve_gauge_like.vy")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.scope, "in-scope")
        self.assertNotEqual(r.contract_class, "custody")
        self.assertEqual(_ADDR["curve_gauge_like.vy"], LIVE_CURVE_3POOL_GAUGE)

    def test_aura_booster_is_convex_family(self):
        r = _lane("aura_booster_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.bucket, "lane-b-queue")
        src = (FIXTURES / "aura_booster_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Booster"), try_slither=False)
        self.assertIn("convex-booster", ir.scope_signals)
        self.assertEqual(_ADDR["aura_booster_like.sol"], LIVE_AURA_BOOSTER)

    def test_spark_pool_is_lending(self):
        r = _lane("spark_pool_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"borrow", "repay", "liquidationCall"})
        self.assertEqual(_ADDR["spark_pool_like.sol"], LIVE_SPARK_POOL)

    def test_liquity_trove_is_lending(self):
        r = _lane("liquity_trove_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertTrue(set(r.value_movers) & {"liquidate", "redeemCollateral"})
        self.assertEqual(_ADDR["liquity_trove_like.sol"], LIVE_LIQUITY_TROVE)

    def test_usds_is_dss_token(self):
        r = _lane("usds_like.sol", tvl=2_000_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.scope, "demoted-token")
        self.assertEqual(r.bucket, "lane-a-cool")
        src = (FIXTURES / "usds_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Usds"), try_slither=False)
        self.assertIn("dss-token", ir.scope_signals)
        self.assertEqual(_ADDR["usds_like.sol"], LIVE_USDS)

    def test_susds_is_vault(self):
        r = _lane("susds_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["susds_like.sol"], LIVE_SUSDS)

    def test_fluid_proxy_missing_facets_is_false_keep(self):
        src = (FIXTURES / "fluid_liquidity_proxy_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="FluidLiquidityProxy"), try_slither=False)
        self.assertEqual(ir.contract_class, "custody")
        self.assertEqual(ir.scope, "in-scope")
        self.assertIn("diamond-facets-missing", ir.scope_signals)
        r = _lane("fluid_liquidity_proxy_like.sol")
        self.assertEqual(r.scope, "in-scope")
        self.assertNotEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["fluid_liquidity_proxy_like.sol"], LIVE_FLUID_LIQ)

    def test_convex_booster_stays_staking(self):
        r = _lane("convex_booster_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_balancer_vault_stays_vault(self):
        r = _lane("balancer_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_curve_pool_stays_pool(self):
        r = _lane("curve_pool_like.sol")
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.bucket, "lane-b-queue")


class Pass12FluidFacetsAndSiblingRoles(unittest.TestCase):
    """Pass 12: Fluid dummy ABI, Lido queue wrap leak, Rocket depositEther call, venues."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_fluid_dummy_impl_is_lending(self):
        src = (FIXTURES / "fluid_liquidity_dummy_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="FluidLiquidityDummyImpl"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        self.assertIn("fluid-liquidity", ir.scope_signals)
        r = _lane("fluid_liquidity_dummy_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["fluid_liquidity_dummy_like.sol"], LIVE_FLUID_DUMMY)

    def test_fluid_proxy_without_modules_is_still_false_keep(self):
        src = (FIXTURES / "fluid_liquidity_proxy_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="FluidLiquidityProxy"), try_slither=False)
        self.assertEqual(ir.contract_class, "custody")
        self.assertIn("diamond-facets-missing", ir.scope_signals)

    def test_lido_withdrawal_queue_is_staking_not_wrap(self):
        src = (FIXTURES / "lido_withdrawal_queue_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="WithdrawalQueueERC721"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertIn("lido-withdrawal-queue", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "wrap-token")
        r = _lane("lido_withdrawal_queue_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["lido_withdrawal_queue_like.sol"], LIVE_LIDO_WQ)

    def test_rocket_deposit_pool_is_staking_not_bridge(self):
        src = (FIXTURES / "rocket_deposit_pool_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RocketDepositPool"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertIn("rocket-deposit-pool", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "bridge")
        r = _lane("rocket_deposit_pool_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["rocket_deposit_pool_like.sol"], LIVE_ROCKET_DP)

    def test_renzo_restake_manager_is_staking(self):
        r = _lane("renzo_restake_manager_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.bucket, "lane-b-queue")
        src = (FIXTURES / "renzo_restake_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RestakeManager"), try_slither=False)
        self.assertIn("renzo-restake", ir.scope_signals)
        self.assertEqual(_ADDR["renzo_restake_manager_like.sol"], LIVE_RENZO_RM)

    def test_liquity_borrower_ops_is_lending(self):
        r = _lane("liquity_borrower_ops_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        src = (FIXTURES / "liquity_borrower_ops_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="BorrowerOperations"), try_slither=False)
        self.assertIn("liquity-borrower", ir.scope_signals)
        self.assertEqual(_ADDR["liquity_borrower_ops_like.sol"], LIVE_LIQUITY_BO)

    def test_maker_pot_is_vault(self):
        r = _lane("maker_pot_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.scope, "in-scope")
        src = (FIXTURES / "maker_pot_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Pot"), try_slither=False)
        self.assertIn("maker-pot", ir.scope_signals)
        self.assertEqual(_ADDR["maker_pot_like.sol"], LIVE_MAKER_POT)

    def test_spark_weth_gateway_is_passthrough(self):
        r = _lane("weth_gateway_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.scope, "demoted-passthrough")
        self.assertEqual(r.bucket, "lane-a-cool")
        src = (FIXTURES / "weth_gateway_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="WrappedTokenGatewayV3"), try_slither=False)
        self.assertIn("weth-gateway", ir.scope_signals)
        self.assertEqual(_ADDR["weth_gateway_like.sol"], LIVE_SPARK_WETH_GW)

    def test_weeth_share_wrap_still_demotes(self):
        r = _lane("weeth_like.sol")
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(r.bucket, "lane-a-cool")


class Pass13CustodyVenues(unittest.TestCase):
    """Pass 13: Maker Join/PSM, Gearbox, CoW settle, frxETH, Uni V4 pin."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_dai_join_is_vault_not_sibling_vat(self):
        src = (FIXTURES / "dai_join_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DaiJoin"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("maker-join", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "maker")
        r = _lane("dai_join_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["dai_join_like.sol"], LIVE_DAI_JOIN)

    def test_gem_join_is_vault_not_sibling_vat(self):
        src = (FIXTURES / "gem_join_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="GemJoin"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("maker-join", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "maker")
        r = _lane("gem_join_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["gem_join_like.sol"], LIVE_ETH_JOIN)

    def test_lite_psm_is_vault_not_utility(self):
        src = (FIXTURES / "dss_lite_psm_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DssLitePsm"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("maker-psm", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "utility")
        self.assertNotEqual(ir.contract_class, "maker")
        r = _lane("dss_lite_psm_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["dss_lite_psm_like.sol"], LIVE_LITE_PSM)

    def test_dsr_manager_is_not_maker_join(self):
        src = (FIXTURES / "dsr_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DsrManager"), try_slither=False)
        self.assertNotIn("maker-join", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "vault")
        r = _lane("dsr_manager_like.sol")
        self.assertEqual(r.contract_class, "custody")
        self.assertEqual(r.scope, "in-scope")
        self.assertEqual(_ADDR["dsr_manager_like.sol"], LIVE_DSR_MANAGER)

    def test_gearbox_credit_manager_is_lending(self):
        src = (FIXTURES / "gearbox_credit_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="CreditManagerV3"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        self.assertIn("gearbox-credit", ir.scope_signals)
        r = _lane("gearbox_credit_manager_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["gearbox_credit_manager_like.sol"], LIVE_GEARBOX_CM)

    def test_cow_settlement_is_passthrough(self):
        src = (FIXTURES / "cow_settlement_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="GPv2Settlement"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertEqual(ir.scope, "demoted-passthrough")
        self.assertIn("cow-settlement", ir.scope_signals)
        r = _lane("cow_settlement_like.sol", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["cow_settlement_like.sol"], LIVE_COW_SETTLEMENT)

    def test_frxeth_is_token_not_custody(self):
        src = (FIXTURES / "frxeth_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="frxETH"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertEqual(ir.scope, "demoted-token")
        r = _lane("frxeth_like.sol", tvl=500_000_000)
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["frxeth_like.sol"], LIVE_FRXETH)

    def test_uni_v4_pool_manager_is_pool_not_cow(self):
        src = (FIXTURES / "uni_v4_pool_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="PoolManager"), try_slither=False)
        self.assertEqual(ir.contract_class, "pool")
        self.assertNotEqual(ir.contract_class, "router")
        self.assertNotIn("cow-settlement", ir.scope_signals)
        r = _lane("uni_v4_pool_manager_like.sol")
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["uni_v4_pool_manager_like.sol"], LIVE_UNI_V4_PM)

    def test_maker_pot_still_vault(self):
        r = _lane("maker_pot_like.sol")
        self.assertEqual(r.contract_class, "vault")
        src = (FIXTURES / "maker_pot_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Pot"), try_slither=False)
        self.assertIn("maker-pot", ir.scope_signals)
        self.assertNotIn("maker-join", ir.scope_signals)


class Pass14CrvusdEulerVenues(unittest.TestCase):
    """Pass 14: UsdsJoin, DaiUsds, crvUSD / Gearbox / Euler pins."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_usds_join_is_vault_without_cage(self):
        src = (FIXTURES / "usds_join_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="UsdsJoin"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("maker-join", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "maker")
        r = _lane("usds_join_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["usds_join_like.sol"], LIVE_USDS_JOIN)

    def test_dai_usds_is_passthrough(self):
        src = (FIXTURES / "dai_usds_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DaiUsds"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertEqual(ir.scope, "demoted-passthrough")
        self.assertIn("dai-usds-converter", ir.scope_signals)
        self.assertNotIn("maker-join", ir.scope_signals)
        r = _lane("dai_usds_like.sol", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["dai_usds_like.sol"], LIVE_DAI_USDS)

    def test_dsr_manager_still_not_maker_join(self):
        r = _lane("dsr_manager_like.sol")
        self.assertEqual(r.contract_class, "custody")
        self.assertNotEqual(r.contract_class, "vault")
        src = (FIXTURES / "dsr_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DsrManager"), try_slither=False)
        self.assertNotIn("maker-join", ir.scope_signals)

    def test_euler_evault_is_lending(self):
        src = (FIXTURES / "euler_evault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="EVault"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        r = _lane("euler_evault_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["euler_evault_like.sol"], LIVE_EULER_EVAULT)

    def test_gearbox_pool_v3_is_vault(self):
        src = (FIXTURES / "gearbox_pool_v3_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="PoolV3"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("erc4626", ir.scope_signals)
        r = _lane("gearbox_pool_v3_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["gearbox_pool_v3_like.sol"], LIVE_GEARBOX_POOL)

    def test_crvusd_controller_is_lending(self):
        src = (FIXTURES / "crvusd_controller_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="crvUSDController"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        r = _lane("crvusd_controller_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(_ADDR["crvusd_controller_like.sol"], LIVE_CRVUSD_CTRL)

    def test_crvusd_llamma_is_pool(self):
        src = (FIXTURES / "crvusd_llamma_like.vy").read_text(encoding="utf-8")
        ir = normalize(_art(src, language="vyper", contract_name="AMM"), try_slither=False)
        self.assertEqual(ir.contract_class, "pool")
        r = _lane("crvusd_llamma_like.vy")
        self.assertEqual(r.contract_class, "pool")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["crvusd_llamma_like.vy"], LIVE_CRVUSD_LLAMMA_IMPL)

    def test_contango_vault_is_vault(self):
        src = (FIXTURES / "contango_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Vault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("contango-vault", ir.scope_signals)
        self.assertEqual(ir.scope, "in-scope")
        r = _lane("contango_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["contango_vault_like.sol"], LIVE_CONTANGO_VAULT)


class Pass15MorphoEthenaVenues(unittest.TestCase):
    """Pass 15: DsrManager vat leak, CometRewards, Aave provider, Ethena/Frax pins."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_dsr_manager_live_shape_not_maker_join(self):
        src = (FIXTURES / "dsr_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DsrManager"), try_slither=False)
        self.assertEqual(ir.contract_class, "custody")
        self.assertNotIn("maker-join", ir.scope_signals)
        r = _lane("dsr_manager_like.sol")
        self.assertEqual(r.contract_class, "custody")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["dsr_manager_like.sol"], LIVE_DSR_MANAGER)

    def test_dai_join_still_maker_join(self):
        src = (FIXTURES / "dai_join_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DaiJoin"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("maker-join", ir.scope_signals)

    def test_comet_rewards_is_passthrough(self):
        src = (FIXTURES / "comet_rewards_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="CometRewards"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertEqual(ir.scope, "demoted-passthrough")
        self.assertIn("comet-rewards", ir.scope_signals)
        r = _lane("comet_rewards_like.sol", tvl=9_999_999)
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["comet_rewards_like.sol"], LIVE_COMET_REWARDS)

    def test_comet_still_lending(self):
        r = _lane("compound_comet_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(_ADDR["compound_comet_like.sol"], LIVE_COMET_USDC)

    def test_pool_addresses_provider_is_utility(self):
        src = (FIXTURES / "pool_addresses_provider_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="PoolAddressesProvider"), try_slither=False)
        self.assertEqual(ir.contract_class, "utility")
        self.assertIn("pool-addresses-provider", ir.scope_signals)
        self.assertNotIn("diamond-facets-missing", ir.scope_signals)
        r = _lane("pool_addresses_provider_like.sol")
        self.assertEqual(r.contract_class, "utility")
        self.assertEqual(_ADDR["pool_addresses_provider_like.sol"], LIVE_AAVE_PROVIDER)

    def test_aave_pool_still_lending(self):
        r = _lane("aave_v3_like.sol")
        self.assertEqual(r.contract_class, "lending")

    def test_usde_is_token(self):
        r = _lane("usde_like.sol")
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["usde_like.sol"], LIVE_USDE)

    def test_susde_is_vault(self):
        src = (FIXTURES / "susde_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="StakedUSDeV2"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("erc4626", ir.scope_signals)
        r = _lane("susde_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["susde_like.sol"], LIVE_SUSDE)

    def test_sfrxeth_is_vault(self):
        r = _lane("sfrxeth_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["sfrxeth_like.sol"], LIVE_SFRXETH)

    def test_balancer_v2_pinned_live(self):
        r = _lane("balancer_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["balancer_vault_like.sol"], LIVE_BALANCER_V2)

    def test_morpho_and_metamorpho_still_correct(self):
        self.assertEqual(_lane("morpho_blue_like.sol").contract_class, "lending")
        self.assertEqual(_lane("metamorpho_like.sol").contract_class, "vault")

    def test_contango_and_euler_proxy_still_honest_keep(self):
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")
        self.assertEqual(_ADDR["euler_evault_like.sol"], LIVE_EULER_EVAULT)
        self.assertEqual(LIVE_EULER_USDC_PROXY.lower()[0:6], "0x797d")


class Pass16LiquityEigenVenues(unittest.TestCase):
    """Pass 16: Liquity V2 Trove/SP, Yearn V3, Puffer, Bold pins."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_liquity_v2_trove_is_lending(self):
        src = (FIXTURES / "liquity_v2_trove_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="TroveManager"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        self.assertIn("liquity-v2-trove", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "custody")
        r = _lane("liquity_v2_trove_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["liquity_v2_trove_like.sol"], LIVE_LQ2_TM_WETH)

    def test_liquity_v1_trove_still_lending(self):
        r = _lane("liquity_trove_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(_ADDR["liquity_trove_like.sol"], LIVE_LIQUITY_TROVE)

    def test_liquity_v2_stability_is_vault(self):
        src = (FIXTURES / "liquity_v2_stability_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="StabilityPool"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("liquity-stability-pool", ir.scope_signals)
        r = _lane("liquity_v2_stability_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["liquity_v2_stability_like.sol"], LIVE_LQ2_SP_WETH)

    def test_bold_is_token(self):
        r = _lane("bold_like.sol")
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["bold_like.sol"], LIVE_BOLD)

    def test_yearn_v3_is_vault(self):
        src = (FIXTURES / "yearn_v3_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="YearnV3Vault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("erc4626", ir.scope_signals)
        r = _lane("yearn_v3_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["yearn_v3_vault_like.sol"], LIVE_YEARN_V3_VAULT)

    def test_puffer_vault_is_vault(self):
        r = _lane("puffer_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["puffer_vault_like.sol"], LIVE_PUFFER_VAULT)

    def test_across_and_eigen_still_correct(self):
        self.assertEqual(_lane("across_spoke_like.sol").contract_class, "bridge")
        self.assertEqual(_lane("across_hub_like.sol").contract_class, "bridge")
        self.assertEqual(_ADDR["across_spoke_like.sol"], LIVE_ACROSS_SPOKE)
        self.assertEqual(_lane("eigen_delegation_like.sol").contract_class, "staking")
        self.assertEqual(_lane("eigen_strategy_like.sol").contract_class, "staking")

    def test_dsr_and_ethena_minting_stay_custody(self):
        self.assertEqual(_lane("dsr_manager_like.sol").contract_class, "custody")
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")

    def test_weeth_still_wrap(self):
        r = _lane("weeth_like.sol")
        self.assertEqual(r.contract_class, "wrap-token")
        self.assertEqual(_ADDR["weeth_like.sol"], LIVE_WEETH)


class Pass17MaplePendleVenues(unittest.TestCase):
    """Pass 17: Maple syrup, Stargate messaging, Enzyme, Origin OETH, LQ2 branches."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_maple_pool_is_vault(self):
        src = (FIXTURES / "maple_pool_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="MaplePool"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("erc4626", ir.scope_signals)
        r = _lane("maple_pool_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["maple_pool_like.sol"], LIVE_SYRUP_USDC)
        self.assertEqual(LIVE_SYRUP_USDT.lower()[0:6], "0x356b")

    def test_maple_syrup_router_is_passthrough(self):
        src = (FIXTURES / "maple_syrup_router_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="SyrupRouter"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertIn("maple-syrup-router", ir.scope_signals)
        r = _lane("maple_syrup_router_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["maple_syrup_router_like.sol"], LIVE_SYRUP_ROUTER)

    def test_stargate_pool_is_bridge(self):
        src = (FIXTURES / "stargate_pool_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="StargatePoolUSDC"), try_slither=False)
        self.assertEqual(ir.contract_class, "bridge")
        r = _lane("stargate_pool_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["stargate_pool_like.sol"], LIVE_STARGATE_USDC)
        self.assertEqual(LIVE_STARGATE_NATIVE.lower()[0:6], "0x77b2")

    def test_stargate_messaging_is_passthrough(self):
        src = (FIXTURES / "stargate_token_messaging_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="TokenMessaging"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertIn("stargate-token-messaging", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "bridge")
        r = _lane("stargate_token_messaging_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["stargate_token_messaging_like.sol"], LIVE_STARGATE_MSG)

    def test_enzyme_vault_is_vault(self):
        src = (FIXTURES / "enzyme_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="VaultLib"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("enzyme-vault", ir.scope_signals)
        r = _lane("enzyme_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["enzyme_vault_like.sol"], LIVE_ENZYME_VAULTLIB)

    def test_origin_oeth_is_vault_not_lido_wq(self):
        src = (FIXTURES / "origin_oeth_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="OETHVault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("origin-oeth-vault", ir.scope_signals)
        self.assertNotIn("lido-withdrawal-queue", ir.scope_signals)
        r = _lane("origin_oeth_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["origin_oeth_vault_like.sol"], LIVE_OETH_VAULT_IMPL)

    def test_lido_wq_still_staking(self):
        r = _lane("lido_withdrawal_queue_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["lido_withdrawal_queue_like.sol"], LIVE_LIDO_WQ)

    def test_liquity_v2_other_branches_reuse_families(self):
        self.assertEqual(_lane("liquity_v2_trove_like.sol").contract_class, "lending")
        self.assertEqual(_lane("liquity_v2_stability_like.sol").contract_class, "vault")
        self.assertEqual(LIVE_LQ2_TM_WSTETH.lower()[0:6], "0xa289")
        self.assertEqual(LIVE_LQ2_SP_WSTETH.lower()[0:6], "0x9502")
        self.assertEqual(LIVE_LQ2_TM_RETH.lower()[0:6], "0xb2b2")
        self.assertEqual(LIVE_LQ2_SP_RETH.lower()[0:6], "0xd442")

    def test_pendle_and_convex_still_correct(self):
        self.assertEqual(_lane("pendle_market_like.sol").contract_class, "pool")
        self.assertEqual(_lane("pendle_router_like.sol").contract_class, "router")
        self.assertEqual(_ADDR["pendle_market_like.sol"], LIVE_PENDLE_MARKET)
        self.assertEqual(LIVE_PENDLE_SY_STETH.lower()[0:6], "0xcbc7")
        self.assertEqual(_lane("convex_booster_like.sol").contract_class, "staking")
        self.assertEqual(LIVE_CONVEX_CVXCRV.lower()[0:6], "0x3fe6")

    def test_dsr_ethena_contango_stay_custody(self):
        self.assertEqual(_lane("dsr_manager_like.sol").contract_class, "custody")
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")
        self.assertEqual(LIVE_ETHENA_MINT.lower()[0:6], "0xe349")


class Pass18UsualTreehouseEtherfi(unittest.TestCase):
    """Pass 18: ether.fi LP, Treehouse router, Usual converter, Reserve RToken."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_etherfi_lp_is_staking_not_curve(self):
        src = (FIXTURES / "etherfi_liquidity_pool_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="LiquidityPool"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertIn("etherfi-liquidity-pool", ir.scope_signals)
        self.assertNotIn("curve-pool", ir.scope_signals)
        r = _lane("etherfi_liquidity_pool_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["etherfi_liquidity_pool_like.sol"], LIVE_ETHERFI_LP)
        self.assertEqual(LIVE_ETHERFI_LP_IMPL.lower()[0:6], "0x17a1")

    def test_treehouse_router_is_passthrough(self):
        src = (FIXTURES / "treehouse_router_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="TreehouseRouter"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertIn("treehouse-router", ir.scope_signals)
        r = _lane("treehouse_router_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["treehouse_router_like.sol"], LIVE_TREEHOUSE_ROUTER)

    def test_usual_dao_collateral_is_passthrough(self):
        src = (FIXTURES / "usual_dao_collateral_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="DaoCollateral"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertIn("usual-dao-collateral", ir.scope_signals)
        r = _lane("usual_dao_collateral_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["usual_dao_collateral_like.sol"], LIVE_DAO_COLLATERAL)

    def test_eusd_rtoken_is_token(self):
        src = (FIXTURES / "rtoken_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RTokenP1"), try_slither=False)
        self.assertEqual(ir.contract_class, "token")
        self.assertEqual(ir.scope, "demoted-token")
        r = _lane("rtoken_like.sol")
        self.assertEqual(r.contract_class, "token")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["rtoken_like.sol"], LIVE_EUSD)

    def test_teth_vault_and_tasset_are_vaults(self):
        vault = normalize(
            _art((FIXTURES / "teth_vault_like.sol").read_text(encoding="utf-8"), contract_name="Vault"),
            try_slither=False,
        )
        self.assertEqual(vault.contract_class, "vault")
        self.assertIn("eth-custody-withdraw", vault.scope_signals)
        tasset = normalize(
            _art((FIXTURES / "teth_tasset_like.sol").read_text(encoding="utf-8"), contract_name="TAsset"),
            try_slither=False,
        )
        self.assertEqual(tasset.contract_class, "vault")
        self.assertIn("erc4626", tasset.scope_signals)
        self.assertEqual(_lane("teth_vault_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_lane("teth_tasset_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_ADDR["teth_vault_like.sol"], LIVE_TETH_VAULT)
        self.assertEqual(_ADDR["teth_tasset_like.sol"], LIVE_TETH_TOKEN)

    def test_usd0pp_stays_custody(self):
        src = (FIXTURES / "usd0pp_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Usd0PP"), try_slither=False)
        self.assertEqual(ir.contract_class, "custody")
        r = _lane("usd0pp_like.sol")
        self.assertEqual(r.contract_class, "custody")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["usd0pp_like.sol"], LIVE_USD0PP)
        self.assertEqual(LIVE_USD0.lower()[0:6], "0x73a1")

    def test_curve_llamma_and_pool_still_pool(self):
        self.assertEqual(_lane("curve_pool_like.sol").contract_class, "pool")
        self.assertEqual(_lane("crvusd_llamma_like.vy").contract_class, "pool")

    def test_pins_and_honest_keeps(self):
        self.assertEqual(_lane("weeth_like.sol").contract_class, "wrap-token")
        self.assertEqual(_lane("eeth_like.sol").contract_class, "token")
        self.assertEqual(_lane("sweth_like.sol").contract_class, "staking")
        self.assertEqual(_lane("meth_like.sol").contract_class, "token")
        self.assertEqual(_lane("susds_like.sol").contract_class, "vault")
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("dsr_manager_like.sol").contract_class, "custody")
        self.assertEqual(LIVE_STAKED_LBTC.lower()[0:6], "0x8236")
        self.assertEqual(LIVE_ETHERFI_WRNFT.lower()[0:6], "0x7d57")
        self.assertEqual(LIVE_SUSDS.lower()[0:6], "0xa393")


class Pass19FolioMantleCcip(unittest.TestCase):
    """Pass 19: Folio factory, BackingManager, Mantle queue, CCIP lock-release."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_folio_deployer_is_factory(self):
        src = (FIXTURES / "folio_deployer_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="FolioDeployer"), try_slither=False)
        self.assertEqual(ir.contract_class, "utility")
        self.assertIn("folio-deployer", ir.scope_signals)
        r = _lane("folio_deployer_like.sol")
        self.assertEqual(r.contract_class, "utility")
        self.assertEqual(r.bucket, "human-no-candidate")
        self.assertEqual(_ADDR["folio_deployer_like.sol"], LIVE_FOLIO_DEPLOYER)

    def test_folio_is_4626_vault(self):
        src = (FIXTURES / "folio_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Folio"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("erc4626", ir.scope_signals)
        r = _lane("folio_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["folio_like.sol"], LIVE_FOLIO_IMPL)

    def test_backing_manager_is_vault_not_fluid(self):
        src = (FIXTURES / "reserve_backing_manager_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="BackingManagerP1"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("reserve-backing-manager", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "lending")
        r = _lane("reserve_backing_manager_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["reserve_backing_manager_like.sol"], LIVE_EUSD_BM)
        self.assertEqual(LIVE_EUSD_BM_IMPL.lower()[0:6], "0x62a5")

    def test_ccip_lock_release_is_bridge(self):
        src = (FIXTURES / "ccip_lock_release_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="LockReleaseTokenPool"), try_slither=False)
        self.assertEqual(ir.contract_class, "bridge")
        self.assertIn("ccip-lock-release", ir.scope_signals)
        r = _lane("ccip_lock_release_like.sol")
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["ccip_lock_release_like.sol"], LIVE_TETH_CCIP)

    def test_mantle_staking_and_unstake_queue(self):
        stake = normalize(
            _art((FIXTURES / "mantle_staking_like.sol").read_text(encoding="utf-8"), contract_name="Staking"),
            try_slither=False,
        )
        self.assertEqual(stake.contract_class, "staking")
        self.assertIn("stake/reward", stake.scope_signals)
        urm = normalize(
            _art((FIXTURES / "mantle_unstake_queue_like.sol").read_text(encoding="utf-8"), contract_name="UnstakeRequestsManager"),
            try_slither=False,
        )
        self.assertEqual(urm.contract_class, "staking")
        self.assertIn("mantle-unstake-queue", urm.scope_signals)
        self.assertEqual(_lane("mantle_staking_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_lane("mantle_unstake_queue_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_ADDR["mantle_staking_like.sol"], LIVE_MANTLE_STAKING)
        self.assertEqual(_ADDR["mantle_unstake_queue_like.sol"], LIVE_MANTLE_URM)

    def test_treehouse_redemption_is_vault(self):
        src = (FIXTURES / "treehouse_redemption_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="TreehouseRedemptionV3"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("treehouse-redemption", ir.scope_signals)
        r = _lane("treehouse_redemption_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["treehouse_redemption_like.sol"], LIVE_TETH_REDEEM)

    def test_fluid_and_pins_still_correct(self):
        self.assertEqual(_lane("fluid_liquidity_dummy_like.sol").contract_class, "lending")
        self.assertEqual(_lane("susds_like.sol").contract_class, "vault")
        self.assertEqual(_lane("usds_like.sol").contract_class, "token")
        self.assertEqual(_lane("sdai_like.sol").contract_class, "vault")
        self.assertEqual(_lane("meth_like.sol").contract_class, "token")
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("usd0pp_like.sol").contract_class, "custody")
        self.assertEqual(_lane("rtoken_like.sol").contract_class, "token")
        self.assertEqual(LIVE_FLUID_VAULT_T1.lower()[0:6], "0x348a")
        self.assertEqual(LIVE_RSWETH.lower()[0:6], "0xfae1")


class Pass20FraxlendSommelierTerm(unittest.TestCase):
    """Pass 20: Fraxlend pair, Sommelier cellar, Term repo, Liquid Collective."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_fraxlend_pair_is_lending_not_router(self):
        src = (FIXTURES / "fraxlend_pair_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="FraxlendPair"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        self.assertIn("fraxlend-pair", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "router")
        r = _lane("fraxlend_pair_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["fraxlend_pair_like.sol"], LIVE_FRAXLEND_SFRXETH)

    def test_sommelier_cellar_beats_sibling_swap_adaptor(self):
        src = (FIXTURES / "sommelier_cellar_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="CellarInitializableV2_1"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("sommelier-cellar", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "router")
        r = _lane("sommelier_cellar_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["sommelier_cellar_like.sol"], LIVE_SOMMELIER_CELLAR_IMPL)

    def test_term_repo_collateral_and_locker_are_vaults(self):
        cm = normalize(
            _art((FIXTURES / "term_repo_collateral_like.sol").read_text(encoding="utf-8"), contract_name="TermRepoCollateralManager"),
            try_slither=False,
        )
        self.assertEqual(cm.contract_class, "vault")
        self.assertIn("term-repo-collateral", cm.scope_signals)
        locker = normalize(
            _art((FIXTURES / "term_repo_locker_like.sol").read_text(encoding="utf-8"), contract_name="TermRepoLocker"),
            try_slither=False,
        )
        self.assertEqual(locker.contract_class, "vault")
        self.assertIn("term-repo-locker", locker.scope_signals)
        self.assertEqual(_lane("term_repo_collateral_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_lane("term_repo_locker_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_ADDR["term_repo_collateral_like.sol"], LIVE_TERM_CM)
        self.assertEqual(_ADDR["term_repo_locker_like.sol"], LIVE_TERM_LOCKER)

    def test_liquid_collective_is_staking(self):
        src = (FIXTURES / "liquid_collective_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="RiverV1"), try_slither=False)
        self.assertEqual(ir.contract_class, "staking")
        self.assertIn("liquid-collective", ir.scope_signals)
        r = _lane("liquid_collective_like.sol")
        self.assertEqual(r.contract_class, "staking")
        self.assertEqual(_ADDR["liquid_collective_like.sol"], LIVE_LSETH)
        self.assertEqual(LIVE_LSETH_IMPL.lower()[0:6], "0x0056")

    def test_pass19_and_honest_keeps_still_correct(self):
        self.assertEqual(_lane("folio_deployer_like.sol").contract_class, "utility")
        self.assertEqual(_lane("reserve_backing_manager_like.sol").contract_class, "vault")
        self.assertEqual(_lane("mantle_unstake_queue_like.sol").contract_class, "staking")
        self.assertEqual(_lane("ccip_lock_release_like.sol").contract_class, "bridge")
        self.assertEqual(_lane("treehouse_redemption_like.sol").contract_class, "vault")
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("usd0pp_like.sol").contract_class, "custody")
        self.assertEqual(_lane("dsr_manager_like.sol").contract_class, "custody")
        self.assertEqual(_lane("fluid_liquidity_dummy_like.sol").contract_class, "lending")
        self.assertEqual(LIVE_CONTANGO_IMPL.lower()[0:6], "0x3cab")
        self.assertEqual(LIVE_GOLDFINCH_SENIOR_IMPL.lower()[0:6], "0x656c")
        self.assertEqual(LIVE_SCRVUSD.lower()[0:6], "0x0655")
        self.assertEqual(LIVE_RSWETH.lower()[0:6], "0xfae1")


class Pass21VedaUpshiftMellow(unittest.TestCase):
    """Pass 21: Veda BoringVault + teller cool, Upshift, Mellow, Clearpool pin."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_veda_boring_vault_is_vault(self):
        src = (FIXTURES / "veda_boring_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="BoringVault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("veda-boring-vault", ir.scope_signals)
        r = _lane("veda_boring_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["veda_boring_vault_like.sol"], LIVE_VEDA_BORING)

    def test_veda_teller_cools_not_bridge(self):
        src = (FIXTURES / "veda_teller_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="LayerZeroTellerWithRateLimiting"), try_slither=False)
        self.assertEqual(ir.contract_class, "router")
        self.assertIn("veda-teller", ir.scope_signals)
        self.assertNotEqual(ir.contract_class, "bridge")
        r = _lane("veda_teller_like.sol")
        self.assertEqual(r.contract_class, "router")
        self.assertEqual(r.bucket, "lane-a-cool")
        self.assertEqual(_ADDR["veda_teller_like.sol"], LIVE_VEDA_TELLER)

    def test_veda_queue_is_vault(self):
        src = (FIXTURES / "veda_queue_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="BoringOnChainQueue"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("veda-withdraw-queue", ir.scope_signals)
        r = _lane("veda_queue_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(_ADDR["veda_queue_like.sol"], LIVE_VEDA_QUEUE)

    def test_upshift_and_mellow_are_vaults(self):
        up = normalize(
            _art((FIXTURES / "upshift_vault_like.sol").read_text(encoding="utf-8"), contract_name="Vault"),
            try_slither=False,
        )
        self.assertEqual(up.contract_class, "vault")
        self.assertIn("upshift-institutional", up.scope_signals)
        mv = normalize(
            _art((FIXTURES / "mellow_vault_like.sol").read_text(encoding="utf-8"), contract_name="MellowVault"),
            try_slither=False,
        )
        self.assertEqual(mv.contract_class, "vault")
        self.assertIn("mellow-vault", mv.scope_signals)
        self.assertEqual(_lane("upshift_vault_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_lane("mellow_vault_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_ADDR["upshift_vault_like.sol"], LIVE_UPSHIFT_VAULT)
        self.assertEqual(_ADDR["mellow_vault_like.sol"], LIVE_MELLOW_VAULT)

    def test_clearpool_impl_already_lending(self):
        src = (FIXTURES / "clearpool_pool_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="PoolMaster"), try_slither=False)
        self.assertEqual(ir.contract_class, "lending")
        r = _lane("clearpool_pool_like.sol")
        self.assertEqual(r.contract_class, "lending")
        self.assertEqual(_ADDR["clearpool_pool_like.sol"], LIVE_CLEARPOOL_IMPL)
        self.assertEqual(LIVE_CLEARPOOL_WINTERMUTE.lower()[0:6], "0xcb28")
        self.assertEqual(LIVE_UPSHIFT_POOL_IMPL.lower()[0:6], "0xc002")

    def test_pass20_pins_and_honest_keeps(self):
        self.assertEqual(_lane("fraxlend_pair_like.sol").contract_class, "lending")
        self.assertEqual(_lane("sommelier_cellar_like.sol").contract_class, "vault")
        self.assertEqual(_lane("term_repo_collateral_like.sol").contract_class, "vault")
        self.assertEqual(_lane("term_repo_locker_like.sol").contract_class, "vault")
        self.assertEqual(_lane("liquid_collective_like.sol").contract_class, "staking")
        self.assertEqual(_lane("contango_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("usd0pp_like.sol").contract_class, "custody")
        self.assertEqual(_lane("dsr_manager_like.sol").contract_class, "custody")
        self.assertEqual(LIVE_CONTANGO_IMPL.lower()[0:6], "0x3cab")
        self.assertEqual(LIVE_GOLDFINCH_SENIOR_IMPL.lower()[0:6], "0x656c")
        self.assertEqual(LIVE_SCRVUSD.lower()[0:6], "0x0655")
        self.assertEqual(LIVE_RSWETH.lower()[0:6], "0xfae1")


class Pass22ConcreteMellowContango(unittest.TestCase):
    """Pass 22: Mellow ERC20RootVault, Concrete async, Contango unique pair."""

    def test_hop_l1_eth_still_unverified(self):
        r = _lane("hop_l1_eth_bridge_like.sol", tvl=50_000_000)
        self.assertEqual(r.contract_class, "bridge")
        self.assertEqual(_ADDR["hop_l1_eth_bridge_like.sol"], LIVE_HOP_ETH)

    def test_mellow_root_vault_is_vault(self):
        src = (FIXTURES / "mellow_root_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="ERC20RootVault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("mellow-root-vault", ir.scope_signals)
        r = _lane("mellow_root_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["mellow_root_vault_like.sol"], LIVE_MELLOW_ROOT_VAULT)

    def test_concrete_async_vault_is_vault(self):
        src = (FIXTURES / "concrete_async_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="ConcreteAsyncVaultImpl"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("concrete-async-vault", ir.scope_signals)
        self.assertNotIn("erc4626", ir.scope_signals)
        r = _lane("concrete_async_vault_like.sol")
        self.assertEqual(r.contract_class, "vault")
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertEqual(_ADDR["concrete_async_vault_like.sol"], LIVE_CONCRETE_WSTETH)
        self.assertEqual(LIVE_CONCRETE_WSTETH_IMPL.lower()[0:6], "0x438d")
        self.assertEqual(LIVE_CONCRETE_DELTA_WEETH.lower()[0:6], "0xb9dc")

    def test_contango_unique_pair_not_fluid(self):
        src = (FIXTURES / "contango_vault_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src, contract_name="Vault"), try_slither=False)
        self.assertEqual(ir.contract_class, "vault")
        self.assertIn("contango-vault", ir.scope_signals)
        fluid_src = (FIXTURES / "fluid_liquidity_dummy_like.sol").read_text(encoding="utf-8")
        fluid_ir = normalize(_art(fluid_src, contract_name="FluidLiquidityDummyImpl"), try_slither=False)
        self.assertEqual(fluid_ir.contract_class, "lending")
        self.assertNotIn("contango-vault", fluid_ir.scope_signals)
        self.assertEqual(_lane("fluid_liquidity_dummy_like.sol").contract_class, "lending")
        self.assertEqual(_lane("contango_vault_like.sol").bucket, "lane-b-queue")
        self.assertEqual(_ADDR["contango_vault_like.sol"], LIVE_CONTANGO_VAULT)
        self.assertEqual(LIVE_CONTANGO_IMPL.lower()[0:6], "0x3cab")

    def test_pass21_pins_and_honest_keeps(self):
        self.assertEqual(_lane("veda_boring_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("veda_teller_like.sol").contract_class, "router")
        self.assertEqual(_lane("veda_queue_like.sol").contract_class, "vault")
        self.assertEqual(_lane("upshift_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("mellow_vault_like.sol").contract_class, "vault")
        self.assertEqual(_lane("clearpool_pool_like.sol").contract_class, "lending")
        self.assertEqual(_lane("usd0pp_like.sol").contract_class, "custody")
        self.assertEqual(_lane("dsr_manager_like.sol").contract_class, "custody")
        self.assertEqual(_lane("erc4626_vault_like.sol").contract_class, "vault")
        self.assertEqual(LIVE_GOLDFINCH_SENIOR_IMPL.lower()[0:6], "0x656c")
        self.assertEqual(LIVE_SCRVUSD.lower()[0:6], "0x0655")
        self.assertEqual(LIVE_RSWETH.lower()[0:6], "0xfae1")


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
