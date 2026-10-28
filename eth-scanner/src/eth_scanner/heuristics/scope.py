"""Lane-A scope filter — funds-at-risk regularity, not a funds oracle.

Lane A only keeps contracts that regularly *hold or account* other people's
value (staking / vaults / lending / AMM reserves / bridges / Maker). Plain
tokens, wrap-tokens, pass-through routers, and atomic NFT markets are
cool-archived. This is a picker. It never stamps yes/no.

Ambiguous *non-token* surfaces stay on the main path (Do Not Auto-Dismiss).
Hybrids (token + vault/pool/lending/staking) stay in-scope when a family
tag fires — prefer false keep.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# Venues that regularly hold / account third-party value. Family promote.
FUNDS_AT_RISK_CLASSES = frozenset({
    "lending", "vault", "staking", "pool", "bridge", "maker",
})
# Back-compat alias used by the funnel S6 gate.
PROMOTE_CLASSES = FUNDS_AT_RISK_CLASSES
# Cool-archive. High TVL must not promote these.
DEMOTE_CLASSES = frozenset({
    "token", "wrap-token", "router", "nft", "nft-market",
})

ERC20_INTERFACE = (
    "transfer", "approve", "transferfrom", "balanceof", "allowance", "totalsupply",
)
ERC20_META = ("name", "symbol", "decimals")
ERC721_INTERFACE = (
    "ownerof", "safetransferfrom", "setapprovalforall", "tokenuri", "balanceof",
)
ERC1155_INTERFACE = (
    "safetransferfrom", "safebatchtransferfrom", "setapprovalforall", "balanceof", "balanceofbatch",
)
TOKEN_ADMIN_NAMES = frozenset({
    "mint", "burn", "issue", "redeem", "rescue", "pause", "unpause",
    "transferownership", "renounceownership", "configureminter",
    "updatemasterminter", "blacklist", "unblacklist", "wipefrozenaddress",
    "increaseallowance", "decreaseallowance", "increaseapproval", "decreaseapproval",
    "permit", "receivewithauthorization", "transferwithauthorization",
    # Circle FiatToken V2 / USDC — live name is rescueERC20, not rescue.
    "rescueerc20", "rescuetoken", "recovererc20", "recovertoken",
    "updaterescuer", "updateblacklister", "updatepauser", "removeminter",
    "cancelauthorization",
    "mintto", "mintbatch", "burnfrom", "burnbatch",
    # Mantle mETH / similar LST receipts — admin, not custody.
    "forcemint", "forceburn",
    # Frax frxETH permissioned mint — receipt token, not a hold.
    "minter_mint", "minter_burn_from",
})
# Prefixes must stay tight. `mint` as a prefix demoted Pendle `mintPyFromSy`
# as token-admin. Exact mint/burn stay in TOKEN_ADMIN_NAMES.
TOKEN_ADMIN_PREFIXES = ("rescue", "recover")

# Unique pass-through verbs. Shared AMM *callbacks* are not unique —
# Uni V3 Pool *calls* uniswapV3SwapCallback; Uni V2 pair *calls* uniswapV2Call.
UNIQUE_ROUTER_NAMES = frozenset({
    "exactinput", "exactinputsingle", "exactoutput", "exactoutputsingle",
    "swapexacttokensfortokens", "swapexactethfortokens", "swapexacttokensforeth",
    "swaptokensforexacttokens", "swapethforexacttokens", "swaptokensforexacteth",
    "unoswap", "unoswap2", "unoswap3", "clipperswap",
    # Pendle Action* router facets (live Implementation is one diamond facet).
    "addliquiditysinglept", "addliquiditysingletoken", "addliquiditysinglesy",
    "addliquiditydualtokenandpt", "addliquiditydualsyandpt",
    "addliquiditysingletokenkeepyt", "addliquiditysinglesykeepyt",
    "removeliquiditysinglept", "removeliquiditysingletoken", "removeliquiditysinglesy",
    "removeliquiditydualtokenandpt", "removeliquiditydualsyandpt",
    "swapexacttokenforpt", "swapexactsyforpt", "swapexacttokenforyt", "swapexactsyforyt",
    "addliquiditysingleptsimple", "swapexacttokenforptsimple",
})
EIGEN_NAMES = frozenset({
    "depositintostrategy", "depositintostrategywithsignature",
    "queuewithdrawals", "completequeuedwithdrawal", "completequeuedwithdrawals",
    "undelegate", "withdrawsharesastokens",
})
COMET_NAMES = frozenset({
    "absorb", "buycollateral", "borrowbalanceof", "accrueaccount",
})
GMX_NAMES = frozenset({
    "buyusdg", "sellusdg", "increaseposition", "decreaseposition",
    "guaranteedusd", "poolamounts",
})
BRIDGE_NAMES = frozenset({
    "depositv3", "depositv3now", "fillv3relay", "fillrelay", "relaytokens",
    "proposerootbundle", "executerootbundle", "claimrelayerrefund",
    "speedupv3deposit",
    # Hop lock-release (L1_ETH_Bridge / L1_ERC20_Bridge).
    "sendtol2", "bondwithdrawal", "bondwithdrawalanddistribute",
    "bondtransferroot", "confirmtransferroot", "challengetransferroot",
    "settlebondedwithdrawals", "settlebondedwithdrawal",
    # Optimism / Base portal + StandardBridge lock-release.
    "deposittransaction", "provewithdrawaltransaction",
    "finalizewithdrawaltransaction", "finalizewithdrawaltransactionexternalproof",
    "provewithdrawal", "finalizewithdrawal",
    "finalizeethwithdrawal", "finalizeerc20withdrawal",
    "finalizebridgeeth", "finalizebridgeerc20",
    "bridgeeth", "bridgeerc20", "bridgeethto", "bridgeerc20to",
    # Arbitrum Inbox / Polygon PoS ether lock.
    "createretryableticket", "unsafecreateretryableticket",
    "depositetherfor",
    # Polygon EtherPredicate / ERC20Predicate / Plasma DepositManager.
    "locktokens", "exittokens", "depositether",
    # Scroll L1 messenger / ETH gateway (ETH is locked on the messenger).
    "relaymessagewithproof", "replaymessage",
    "finalizewithdraweth", "finalizewithdrawerc20",
    # Starknet StarkGate / StarknetEthBridge.
    "depositwithmessage",
    # zkSync Era Mailbox / L1ERC20Bridge.
    "requestl2transaction", "bridgehubrequestl2transaction",
    "finalizeethwithdrawal",
    # Polygon FxPortal lock-release tunnels (not FxRoot messaging).
    "receivemessage", "processmessagefromchild",
})
SHARE_WRAP_NAMES = frozenset({
    "getwstethbysteth", "getstethbywsteth", "stethpertoken", "tokenspersteth",
    # weETH (`0xCd5f…b7ee`) wrap of eETH — same pattern as wstETH/stETH.
    "getweethbyeeth", "geteethbyweeth",
    # rsETH / Kelp and wrsETH-shaped wraps (false-keep like weETH when wrap/unwrap).
    "getrsethbyeth", "getethbyrseth", "rsethpereth", "ethperrseth",
    "getrsethbyasset", "getassetbyrseth",
    # ezETH / Renzo wrap of ezETH.
    "getezethbyeth", "getethbyezeth", "ezethpereth", "ethperezeth",
    # cbETH / Coinbase staked wrap converters (if a wrap helper exists).
    "getcbethbyeth", "getethbycbeth", "cbethpereth", "ethpercbeth",
    # Origin wOETH wrap of rebasing OETH (weETH-class).
    "getwoethbyoeth", "getoethbywoeth", "woethperoeth", "oethperwoeth",
})
# Token-to-token wrap movers. WETH uses deposit/withdraw; these do not.
_SHARE_WRAP_MOVERS = frozenset({"wrap", "unwrap"})
_SHARE_WRAP_RATE_RX = re.compile(
    r"\b(getWstETHByStETH|getStETHByWstETH|stEthPerToken|tokensPerStEth|"
    r"getWeETHByeETH|getEETHByWeETH|"
    r"getRsETHByETH|getETHByRsETH|rsETHPerETH|getRsETHByAsset|"
    r"getEzETHByETH|getETHByEzETH|ezETHPerETH|"
    r"getCbETHByETH|getETHByCbETH|cbETHPerETH|"
    r"getWOETHByOETH|getOETHByWOETH|woETHPerOETH)\b",
)
LRT_DEPOSIT_NAMES = frozenset({
    "depositasset", "getrsethamounttomint", "gettotalassetdeposits",
})
SWELL_LST_NAMES = frozenset({
    "reprice", "swethtoethrate", "ethtoswethrate", "rswethtoethrate",
})
ROCKET_RETH_NAMES = frozenset({"getethvalue", "getrethvalue"})
# DSS token transfer aliases (Dai `move`/`push`/`pull`). Not Vat verbs.
DSS_TOKEN_ALIASES = frozenset({"move", "push", "pull"})
VAT_VERBS = frozenset({
    "frob", "flux", "suck", "grab", "heal", "fold", "slip",
})
PENDLE_MARKET_NAMES = frozenset({
    "swapexactptforsy", "swapexactsyforpt", "swapsyforexactpt",
    "readstate", "readtokens",
})
CONVEX_NAMES = frozenset({
    "earmarkrewards", "earmarkfees",
})
CURVE_GAUGE_NAMES = frozenset({
    "set_approve_deposit", "claimable_tokens", "claimable_reward",
})
ROUTER_CALLBACK_NAMES = frozenset({
    "uniswapv3swapcallback", "uniswapv2call",
})
# Union kept for callers / tests that still mention ROUTER_NAMES.
ROUTER_NAMES = UNIQUE_ROUTER_NAMES | ROUTER_CALLBACK_NAMES
# Custody AMM surface. mint+burn alone is token admin — need a reserve verb.
POOL_MOVER_NAMES = frozenset({
    "swap", "mint", "burn", "collect", "flash", "collectprotocol",
    "getreserves", "add_liquidity", "remove_liquidity", "addliquidity",
    "removeliquidity", "exchange", "skim",
})
POOL_RESERVE_VERBS = frozenset({
    "swap", "flash", "collect", "collectprotocol", "getreserves",
    "add_liquidity", "remove_liquidity", "addliquidity", "removeliquidity",
    "exchange", "skim",
})
NFT_MARKET_NAMES = frozenset({
    "fulfillorder", "fulfillbasicorder", "fulfillavailableorders",
    "fulfillavailableadvancedorders", "matchorders", "matchadvancedorders",
    "atomicmatch", "atomicmatch_",
    "takeask", "takebid", "taketoken",
    "matchaskwithtakerbid", "matchbidwithtakerask",
    "settleorder", "buyitem", "buyedition",
})
ESCROW_NAMES = frozenset({
    "escrow", "depositeth", "withdraweth", "depositweth", "withdrawweth",
})

_FN_NAME = re.compile(r"\bfunction\s+(\w+)\s*\(", re.I)
_VYPER_DEF = re.compile(r"(?m)^[ \t]*def\s+(\w+)\s*\(")
# `Slot0 public override slot0` / `uint128 public override liquidity` — live
# Uni V3 Pool storage. The old type-list + `public (\w+)` captured `override`.
_PUBLIC_GETTER = re.compile(
    r"\b(?:mapping\s*\([^;]*\)|uint\d*|u256|int\d*|bool|address|string|bytes\d*|\w+)\s+"
    r"public\s+(?:(?:immutable|override|constant)\s+)*(\w+)",
    re.I,
)
# `abstract contract Foo is Bar {` — group 1 is contract|interface|library.
_TYPE_HEAD = re.compile(
    r"\b(?:abstract\s+)?(contract|interface|library)\s+(\w+)\b",
    re.I,
)
_USING_FOR = re.compile(r"\busing\s+(\w+)\s+for\b", re.I)
_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.S)
_COMMENT_LINE = re.compile(r"//.*?$", re.M)
_VERSION_TAIL = re.compile(r"(?:[._-]?v?\d+)+$", re.I)
# Strip these from *either* side of an Etherscan ContractName alias.
# Do not include short/generic stems (token, vault, pool, market).
_ALIAS_SUFFIXES = (
    "implementation",
    "upgradeable",
    "interface",
    "instance",
    "proxy",
    "impl",
    "logic",
    "module",
    "facet",
)
_DIAMOND_NAMES = frozenset({
    "diamondcut", "facetaddresses", "facetaddress", "facets",
    "facetfunctionselectors",
})
YEARN_SHARE_NAMES = frozenset({
    "pricepershare", "getpriceperfullshare",
    "price_per_share", "get_price_per_full_share",
})


@dataclass
class ScopeDecision:
    contract_class: str
    scope: str  # in-scope | demoted-token | demoted-passthrough | utility | unknown
    signals: list[str] = field(default_factory=list)
    promote: bool = False

    @property
    def demoted(self) -> bool:
        return self.scope in {"demoted-token", "demoted-passthrough"}


def classify_scope(
    *,
    source: str = "",
    functions: Optional[Iterable[Any]] = None,
    extra_names: Optional[Iterable[str]] = None,
    contract_name: Optional[str] = None,
) -> ScopeDecision:
    """Classify a contract from source text + lifted functions.

    Funds-at-risk families are checked *before* ERC-20 / ERC-721 shape so a
    vault, cToken, Curve pool, or staking token is never demoted as a token.
    """
    src = source or ""
    fns = list(functions or [])
    names = _collect_names(src, fns, extra_names)
    # Same-file sibling IR roles (wrap-unwrap / admin / staking) must not
    # overwrite this contract's role for a shared name like deposit.
    role_fns = fns
    if contract_name:
        declared_roles = _contract_declared_names(src, contract_name)
        if declared_roles:
            focused_role_fns = [
                fn for fn in fns
                if (getattr(fn, "name", "") or "").lower() in declared_roles
            ]
            if focused_role_fns:
                role_fns = focused_role_fns
    roles = {(getattr(fn, "name", "") or "").lower(): (getattr(fn, "role", "") or "") for fn in role_fns}
    custody = [
        (getattr(fn, "name", "") or "").lower()
        for fn in fns
        if getattr(fn, "is_value_mover", False)
        and getattr(fn, "exposed", False)
        and (getattr(fn, "role", "") or "custody") not in {"erc20-standard"}
    ]
    # Same-file Sourcify siblings (RSETH + LRTDepositPool, EzEthToken +
    # RestakeManager) share one IR file path, so normalize cannot drop the
    # other contract's movers. Intersect with this-contract names when
    # Etherscan named the primary. Empty intersect keeps the raw set
    # (diamond / rename — prefer false keep).
    if contract_name and custody:
        declared_here = _contract_declared_names(src, contract_name)
        if declared_here:
            focused_custody = [n for n in custody if n in declared_here]
            if focused_custody:
                custody = focused_custody
    # Same-file sibling WETH (live mETH flatten) has deposit/withdraw +
    # msg.value and IR wrap-unwrap roles. Only this contract counts.
    wrap_role_names = {
        (getattr(fn, "name", "") or "").lower()
        for fn in fns
        if getattr(fn, "role", "") == "wrap-unwrap"
    }
    wrap_names = _this_or_names(src, names, contract_name)
    if contract_name and wrap_role_names:
        declared_here = _contract_declared_names(src, contract_name)
        if declared_here:
            wrap_role_names &= declared_here
    wrap = bool(wrap_role_names) or bool(
        {"deposit", "withdraw", "wrap", "unwrap"} & wrap_names
        and _weth_shape(src, names, contract_name)
    )
    # wstETH-like share wrap holds the inner token the same way WETH holds ETH.
    # Live wstETH (`0x7f39…Ca0`) imported `getPooledEthByShares` and became staking.
    if _is_share_wrap(src, names, custody, contract_name):
        return ScopeDecision(
            contract_class="wrap-token",
            scope="demoted-token",
            signals=["share-wrap"],
            promote=False,
        )

    family, family_signals = _funds_at_risk_family(src, names, custody, contract_name)
    if family:
        return ScopeDecision(
            contract_class=family,
            scope="in-scope",
            signals=family_signals,
            promote=family in FUNDS_AT_RISK_CLASSES,
        )

    erc20 = _interface_score(src, names, ERC20_INTERFACE, contract_name)
    erc721 = _interface_score(src, names, ERC721_INTERFACE, contract_name)
    erc1155 = _interface_score(src, names, ERC1155_INTERFACE, contract_name)
    token_admin_only = bool(custody) and all(_is_token_admin(n) for n in custody)
    wrap_only = wrap and all(
        roles.get(n) in {"wrap-unwrap", "erc20-standard", ""} or _is_token_admin(n)
        for n in custody
    )

    token_shaped = erc20 >= 3 or (erc20 >= 2 and _has_meta(src, names)) or (
        erc20 >= 2 and token_admin_only
    )

    # Second-chance hybrid: ERC-20 shape plus a hold signal the first pass missed.
    if token_shaped:
        hybrid, hybrid_signals = _hybrid_hold(src, names, custody, contract_name)
        if hybrid:
            return ScopeDecision(
                contract_class=hybrid,
                scope="in-scope",
                signals=["hybrid-token+%s" % hybrid] + hybrid_signals,
                promote=hybrid in FUNDS_AT_RISK_CLASSES,
            )
        # Live Dai (`0x6B17…1d0F`) is a DSS ERC-20: wards + auth + move/push/pull.
        # Those used to fire maker via the auth+wards fallback. Vat has frob.
        if _is_dss_token(src, names, contract_name):
            return ScopeDecision(
                contract_class="token",
                scope="demoted-token",
                signals=["dss-token"],
                promote=False,
            )
        if not custody or token_admin_only or wrap_only:
            klass = "wrap-token" if (wrap or wrap_only) else "token"
            return ScopeDecision(
                contract_class=klass,
                scope="demoted-token",
                signals=["erc20-interface:%d" % erc20] + (["wrap-unwrap"] if klass == "wrap-token" else [])
                + (["token-admin-only"] if token_admin_only else []),
                promote=False,
            )
        # ERC-20 *plus* a non-admin custody mover we did not family-tag.
        # Live SwapRouter after #27 landed here: IERC20.sol in the Etherscan
        # multi-file blob made the name set look token-shaped, so this keep
        # skipped pass-through demotion (bucket=lane-b-queue, class=custody).
        # Imported IERC20 on a router is not this contract holding funds.
        # Live Uni V3 Pool after #28 also looked ERC-20 shaped (IERC20Minimal
        # in the blob) *and* `_is_router` fired on IUniswapV3SwapCallback —
        # that is a keep (reserves), not a passthrough.
        passthru, pass_signals = _passthrough_family(src, names, custody, contract_name)
        if passthru:
            return ScopeDecision(
                contract_class=passthru,
                scope="demoted-passthrough",
                signals=["imported-erc20-on-passthrough"] + pass_signals,
                promote=False,
            )
        # Prefer false keep — may be an unnamed vault.
        return ScopeDecision(
            contract_class="custody",
            scope="in-scope",
            signals=["erc20-plus-custody:%s" % ",".join(custody[:8])],
            promote=False,
        )

    passthru, pass_signals = _passthrough_family(src, names, custody, contract_name)
    if passthru:
        return ScopeDecision(
            contract_class=passthru,
            scope="demoted-passthrough",
            signals=pass_signals,
            promote=False,
        )

    if (erc721 >= 3 or erc1155 >= 3) and (not custody or token_admin_only):
        if _nft_escrow(src, names):
            return ScopeDecision(
                contract_class="custody",
                scope="in-scope",
                signals=["nft-escrow"],
                promote=False,
            )
        klass = "nft"
        return ScopeDecision(
            contract_class=klass,
            scope="demoted-token",
            signals=["erc721-interface:%d" % erc721] if erc721 >= erc1155 else ["erc1155-interface:%d" % erc1155],
            promote=False,
        )

    if wrap and (not custody or wrap_only):
        return ScopeDecision(
            contract_class="wrap-token",
            scope="demoted-token",
            signals=["wrap-unwrap"],
            promote=False,
        )

    # Aave / Spark PoolAddressesProvider: registry of pool proxies. The
    # Sourcify tree ships Proxy.sol (fallback+delegatecall) and used to
    # false-keep as diamond-facets-missing. ACLManager is already utility.
    if _is_pool_addresses_provider(src, names, contract_name):
        return ScopeDecision(
            contract_class="utility",
            scope="utility",
            signals=["pool-addresses-provider"],
            promote=False,
        )

    # Diamond loupe / EIP-2535 proxy whose facet files are not in the blob.
    # Prefer false keep — Do Not Auto-Dismiss a possible custody venue.
    if _diamond_loupe_without_venue(src, names, contract_name):
        return ScopeDecision(
            contract_class="custody",
            scope="in-scope",
            signals=["diamond-facets-missing"],
            promote=False,
        )

    if custody:
        # Last-chance pass-through: custody movers that are only router verbs.
        # Own reserves / pool-cluster (mint/collect/burn/swap/flash) stay in.
        if _is_router(src, names, custody, contract_name) and not _hold_signal(src, names, include_amm=False, focus=contract_name):
            return ScopeDecision(
                contract_class="router",
                scope="demoted-passthrough",
                signals=["passthrough-router"] + ["custody-movers:%s" % ",".join(custody[:8])],
                promote=False,
            )
        flash_only = set(custody) <= {
            "flashloan", "receiveflashloan", "onflashloan", "uniswapv3flashcallback",
        }
        if flash_only and not _hold_signal(src, names, focus=contract_name):
            return ScopeDecision(
                contract_class="utility",
                scope="demoted-passthrough",
                signals=["flash-adapter-no-reserves"],
                promote=False,
            )
        return ScopeDecision(
            contract_class="custody",
            scope="in-scope",
            signals=["custody-movers:%s" % ",".join(custody[:8])],
            promote=False,
        )

    if not names and not src.strip():
        return ScopeDecision(contract_class="unknown", scope="unknown", signals=["empty"], promote=False)

    if _diamond_loupe_without_venue(src, names, contract_name):
        return ScopeDecision(
            contract_class="custody",
            scope="in-scope",
            signals=["diamond-facets-missing"],
            promote=False,
        )

    return ScopeDecision(
        contract_class="utility",
        scope="utility",
        signals=["no-custody-movers"],
        promote=False,
    )


def _is_token_admin(name: str) -> bool:
    """Mint/burn/rescue-style admin on an ERC-20 is still a token, not custody.

    Live USDC (FiatTokenV2_2) exposes `rescueERC20`, not `rescue`. Exact-name
    matching missed that and kept the token on the main lane.
    """
    n = (name or "").lower()
    if not n:
        return False
    if n in TOKEN_ADMIN_NAMES or n in DSS_TOKEN_ALIASES:
        return True
    return any(n.startswith(p) for p in TOKEN_ADMIN_PREFIXES)


def _collect_names(src: str, fns: list[Any], extra: Optional[Iterable[str]]) -> set[str]:
    names = {(getattr(fn, "name", "") or "").lower() for fn in fns}
    names.update(n.lower() for n in _FN_NAME.findall(src or ""))
    names.update(n.lower() for n in _VYPER_DEF.findall(src or ""))
    names.update(n.lower() for n in _PUBLIC_GETTER.findall(src or ""))
    if extra:
        names.update(str(n).lower() for n in extra if n)
    return {n.lower() for n in names if n}


def _interface_score(
    src: str,
    names: set[str],
    interface: Iterable[str],
    focus: Optional[str] = None,
) -> int:
    """Count *this* contract's ERC interface, not IERC20 on imported files.

    Live Uni V3 SwapRouter is a multi-file Etherscan blob (IERC20 + pool
    iface + PeripheryPayments + SwapRouter). The global name set therefore
    looks ERC-20 shaped even though SwapRouter does not implement
    transfer/approve. Prefer names declared inside `contract` blocks.
    When source is empty (IR-only extra_names, e.g. live USDC), fall back
    to the collected name set so token demotion still works.
    """
    implemented = _contract_declared_names(src, focus)
    pool = implemented if implemented else names
    search_src = _contract_bodies(src, focus) if implemented else (src or "")
    score = 0
    for item in interface:
        if item in pool:
            score += 1
            continue
        if re.search(r"\bfunction\s+%s\s*\(" % re.escape(item), search_src, re.I):
            score += 1
            continue
        if item in {"balanceof", "allowance", "totalsupply", "name", "symbol", "decimals", "ownerof"}:
            if re.search(r"\bpublic\s+(?:override\s+)?%s\b" % re.escape(item), search_src, re.I):
                score += 1
    return score


def _type_blocks(src: str) -> list[tuple[str, str, str]]:
    """Return (kind, name, body) for top-level Solidity type declarations."""
    text = src or ""
    # Raw Etherscan JSON still has JSON braces — do not brace-match it.
    if text.lstrip().startswith("{"):
        return []
    blank = _sol_without_comments(text)
    out: list[tuple[str, str, str]] = []
    for m in _TYPE_HEAD.finditer(blank):
        kind = (m.group(1) or "").lower()
        name = m.group(2) or ""
        brace = blank.find("{", m.end())
        if brace < 0:
            continue
        gap = blank[m.end():brace]
        if re.search(r"\b(?:abstract\s+)?(?:contract|interface|library)\b", gap, re.I):
            continue
        body, _end = _brace_span(text, brace)
        if body is None:
            continue
        out.append((kind, name, body))
    return out


def _norm_ident(name: str) -> str:
    return (name or "").strip().lower()


def _sol_without_comments(src: str) -> str:
    """Blank `//` and `/* */` comments, keeping offsets (newlines stay).

    `_TYPE_HEAD` is word-bounded. NatSpec like `this contract is the hub`
    used to spawn fake types (`contract is`) and break primary focus.
    """
    def _spaces(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    text = _COMMENT_BLOCK.sub(_spaces, src or "")
    return _COMMENT_LINE.sub(_spaces, text)


def _alias_stem(name: str) -> str:
    """Strip version / impl / facet suffixes. `PoolInstance` → `pool`."""
    n = _norm_ident(name)
    if not n:
        return ""
    while True:
        m = _VERSION_TAIL.search(n)
        if not m or m.start() == 0:
            break
        n = n[:m.start()]
    for suf in _ALIAS_SUFFIXES:
        if n.endswith(suf) and len(n) > len(suf):
            n = n[: -len(suf)]
            break
    return n


def _ident_match(declared: str, primary: str) -> bool:
    """True when `declared` is the Etherscan primary (or a versioned alias).

    `Morpho` must not match `MetaMorpho`. `Pool` may match `PoolInstance`.
    Also `VaultV3` / `TokenImpl` / `FooFacet` / `HubPoolInterface`.
    """
    a, b = _norm_ident(declared), _norm_ident(primary)
    if not a or not b:
        return False
    if a == b:
        return True

    def _extends(long: str, short: str) -> bool:
        if not long.startswith(short) or len(long) <= len(short):
            return False
        rest = long[len(short):]
        return rest[0] in "._-vV" or rest.startswith(_ALIAS_SUFFIXES)

    if _extends(a, b) or _extends(b, a):
        return True
    sa, sb = _alias_stem(a), _alias_stem(b)
    return bool(sa and sb and sa == sb and len(sa) >= 3)


def _contract_bases(src: str) -> dict[str, list[str]]:
    """Map lowercase contract name → inherited type names."""
    out: dict[str, list[str]] = {}
    for m in re.finditer(
        r"\b(?:abstract\s+)?contract\s+(\w+)\s+is\s+([^{]+)\s*\{",
        _sol_without_comments(src or ""),
        re.I,
    ):
        bases: list[str] = []
        for part in (m.group(2) or "").split(","):
            ident = re.match(r"\s*(\w+)", part)
            if ident:
                bases.append(ident.group(1))
        out[_norm_ident(m.group(1))] = bases
    return out


def _focus_chain(src: str, focus: Optional[str]) -> set[str]:
    """Primary contract + `is` inheritance, lowercase. Empty = no match."""
    if not focus:
        return set()
    names = [n for kind, n, _body in _type_blocks(src) if kind == "contract"]
    roots = [n for n in names if _ident_match(n, focus)]
    if not roots:
        return set()
    bases = _contract_bases(src)
    chain = {_norm_ident(n) for n in roots}
    stack = list(chain)
    while stack:
        cur = stack.pop()
        for raw in bases.get(cur, []):
            key = _norm_ident(raw)
            if key and key not in chain:
                chain.add(key)
                stack.append(key)
    return chain


def _library_blocks(src: str) -> list[tuple[str, str, str]]:
    return [(k, n, b) for k, n, b in _type_blocks(src) if k == "library"]


def _used_libraries(src: str, focus: Optional[str], contract_blocks: list[tuple[str, str, str]]) -> set[str]:
    """Libraries the primary inherits via `using Lib for` or `Lib.fn` calls.

    MarketMathCore implements Pendle swap/addLiquidity; the market only
    `using MarketMathCore for MarketState`. Prefer false keep for those
    movers — do not pull in unused sibling libraries.
    """
    used: set[str] = set()
    search = "\n".join(body for _k, _n, body in contract_blocks)
    for m in _USING_FOR.finditer(search):
        ident = _norm_ident(m.group(1))
        if ident:
            used.add(ident)
    for _kind, name, _body in _library_blocks(src):
        key = _norm_ident(name)
        if key and re.search(r"\b%s\s*\." % re.escape(name), search):
            used.add(key)
    if focus:
        fkey = _norm_ident(focus)
        for _kind, name, _body in _library_blocks(src):
            if _ident_match(name, focus) or _norm_ident(name) == fkey:
                used.add(_norm_ident(name))
    return used


def _diamond_incomplete(
    focused: list[tuple[str, str, str]],
    all_contracts: list[tuple[str, str, str]],
) -> bool:
    """True when ContractName hit a thin diamond/loupe and siblings have movers.

    Prefer false keep: missing facet files must not cool-archive a venue.
    """
    if not focused or len(focused) >= len(all_contracts):
        return False
    fns: set[str] = set()
    diamondish = False
    for _k, _n, body in focused:
        fns.update(n.lower() for n in _FN_NAME.findall(body))
        if re.search(r"\bdelegatecall\b", body) and re.search(r"\bfallback\b", body):
            diamondish = True
    if fns & _DIAMOND_NAMES:
        diamondish = True
    if not diamondish:
        return False
    sibling: set[str] = set()
    for _k, _n, body in all_contracts:
        sibling.update(n.lower() for n in _FN_NAME.findall(body))
    extra = sibling - fns
    venue = (
        UNIQUE_ROUTER_NAMES
        | PENDLE_MARKET_NAMES
        | GMX_NAMES
        | BRIDGE_NAMES
        | EIGEN_NAMES
        | COMET_NAMES
        | CONVEX_NAMES
        | CURVE_GAUGE_NAMES
        | POOL_RESERVE_VERBS
        | LRT_DEPOSIT_NAMES
        | {
            "deposit", "withdraw", "redeem", "borrow", "repay", "stake",
            "unstake", "supply", "mint", "burn", "swap", "addliquidity",
        }
    )
    return bool(extra & venue) or len(fns) <= 8


def _venue_verbs() -> set[str]:
    return (
        UNIQUE_ROUTER_NAMES
        | PENDLE_MARKET_NAMES
        | GMX_NAMES
        | BRIDGE_NAMES
        | EIGEN_NAMES
        | COMET_NAMES
        | CONVEX_NAMES
        | CURVE_GAUGE_NAMES
        | POOL_RESERVE_VERBS
        | VAT_VERBS
        | LRT_DEPOSIT_NAMES
        | {
            "deposit", "withdraw", "redeem", "borrow", "repay", "stake",
            "unstake", "supply", "mint", "burn", "swap", "addliquidity",
        }
    )


def _diamond_loupe_without_venue(
    src: str,
    names: set[str],
    _focus: Optional[str] = None,
) -> bool:
    """True when the blob is a diamond/loupe and no facet venue verbs are visible.

    ContractName may be Diamond / PendleRouterV4 / LiFi. Action* / vault
    facets are often a different verified address. Prefer false keep —
    do not cool-archive a possible custody diamond as utility.
    Unique-router names (PendleRouter, exactInput) are handled earlier.
    """
    blocks = [(k, n, b) for k, n, b in _type_blocks(src) if k == "contract"]
    fns: set[str] = set()
    diamondish = False
    for _k, name, body in blocks:
        fns.update(n.lower() for n in _FN_NAME.findall(body))
        if _ident_match(name, "Diamond") or re.search(r"Diamond$", name or ""):
            diamondish = True
        if re.search(r"\bdelegatecall\b", body) and re.search(r"\bfallback\b", body):
            diamondish = True
    if fns & _DIAMOND_NAMES:
        diamondish = True
    if not diamondish and not (names & _DIAMOND_NAMES):
        return False
    if not diamondish:
        diamondish = bool(re.search(r"\bdelegatecall\b", src) and re.search(r"\bfallback\b", src))
    if not diamondish:
        return False
    pool = fns or set(names)
    return not bool(pool & _venue_verbs())


def _is_dss_token(src: str, names: set[str], focus: Optional[str] = None) -> bool:
    """Dai-like DSS ERC-20: wards + auth, no Vat verbs (frob/flux/…)."""
    declared = _contract_declared_names(src, focus)
    pool = declared if declared else names
    if VAT_VERBS & pool:
        return False
    if re.search(r"\bfunction\s+frob\s*\(", src):
        return False
    return bool(re.search(r"\bmodifier\s+auth\b", src)) and bool(re.search(r"\bwards\s*\[", src))


def _focused_blocks(src: str, focus: Optional[str]) -> list[tuple[str, str, str]]:
    """`contract` blocks for the primary + parents. No match → all contracts.

    Prefer false keep: if Etherscan's ContractName does not appear in the
    blob, do not drop the tree (diamonds / renamed impls). Include libraries
    the primary `using`s. Diamond loupes that miss facet files keep siblings.
    """
    blocks = [(k, n, b) for k, n, b in _type_blocks(src) if k == "contract"]
    if not focus or not blocks:
        return blocks
    chain = _focus_chain(src, focus)
    if not chain:
        return blocks
    hit = [(k, n, b) for k, n, b in blocks if _norm_ident(n) in chain]
    if not hit:
        return blocks
    if _diamond_incomplete(hit, blocks):
        return blocks
    used = _used_libraries(src, focus, hit)
    if used:
        hit = hit + [
            (k, n, b) for k, n, b in _library_blocks(src) if _norm_ident(n) in used
        ]
    return hit


def _brace_span(src: str, open_idx: int) -> tuple[Optional[str], int]:
    depth = 0
    for i in range(open_idx, len(src)):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return src[open_idx + 1:i], i
    return None, open_idx


def _path_matches_focus(
    path: str,
    focus: Optional[str],
    chain: Optional[set[str]] = None,
    libraries: Optional[set[str]] = None,
) -> bool:
    """True when a source path belongs to the primary, a parent, or a used lib.

    Matches file stem *and* path components (`core/Market/PendleMarket.sol`).
    """
    if not focus or not path:
        return False
    blob = (path or "").replace("\\", "/")
    parts = [p for p in blob.split("/") if p]
    stem = parts[-1] if parts else ""
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    chain = chain or set()
    libraries = libraries or set()
    if _ident_match(stem, focus) or _norm_ident(stem) in chain or _norm_ident(stem) in libraries:
        return True
    key = _norm_ident(focus)
    if key and (f"/{key}.sol" in f"/{blob.lower()}" or f"/{key}.vy" in f"/{blob.lower()}"):
        return True
    for part in parts[:-1]:
        if _ident_match(part, focus) or _norm_ident(part) in chain or _norm_ident(part) in libraries:
            return True
    return False


def _contract_declared_names(src: str, focus: Optional[str] = None) -> set[str]:
    names: set[str] = set()
    for _kind, _name, body in _focused_blocks(src, focus):
        names.update(n.lower() for n in _FN_NAME.findall(body))
        names.update(n.lower() for n in _PUBLIC_GETTER.findall(body))
    return names


def _contract_bodies(src: str, focus: Optional[str] = None) -> str:
    return "\n".join(body for _kind, _name, body in _focused_blocks(src, focus))


def _has_meta(src: str, names: set[str]) -> bool:
    return sum(1 for m in ERC20_META if m in names or re.search(r"\b%s\b" % m, src, re.I)) >= 2


def _weth_shape(src: str, names: set[str], focus: Optional[str] = None) -> bool:
    wrap_names = _this_or_names(src, names, focus)
    if not ({"deposit", "withdraw", "wrap", "unwrap"} & wrap_names):
        return False
    return bool(re.search(
        r"balanceOf\s*\[\s*msg\.sender\s*\]\s*\+|msg\.value",
        _family_search(src, focus),
    ))


def _probe_names(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> set[str]:
    """Prefer this-contract movers / declared names over imported interfaces.

    Live Uni V3 Pool + SwapRouter share a flattened Etherscan blob shape:
    IERC20 + IUniswapV3Pool + callback ifaces. The global name set is the
    union of every file. Custody movers and `contract` bodies are *this*
    address. Fall back to the collected set only for IR-only (empty source).
    Movers stay unfiltered here (diamond facets). Lending identity intersects
    them with the primary contract separately.
    """
    movers = {str(n).lower() for n in (custody or []) if n}
    if movers:
        return movers
    implemented = _contract_declared_names(src, focus)
    if implemented:
        return implemented
    return set(names)


def _unique_router(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> bool:
    """True when *this* contract is an exactInput-style pass-through."""
    if _probe_names(src, names, custody, focus) & UNIQUE_ROUTER_NAMES:
        return True
    # Diamond / Action* facets: scan every contract name, not only primary.
    implemented = _contract_declared_names(src)
    if implemented:
        for kind, name, _body in _type_blocks(src):
            if kind == "contract" and re.search(
                r"(SwapRouter|UniversalRouter|UniswapV2Router|PendleRouter|"
                r"ActionAddRemoveLiq|ActionSwap|AggregationRouter)",
                name,
            ):
                return True
        search = _contract_bodies(src)
    else:
        search = src or ""
    return bool(re.search(
        r"\b(exactInput(Single)?|exactOutput(Single)?|swapExactTokensForTokens|"
        r"swapExactETHForTokens|SwapRouter|UniversalRouter|UniswapV2Router|"
        r"PendleRouter|ActionAddRemoveLiq|unoswap|clipperSwap|"
        r"addLiquiditySingle(Pt|Token|Sy)|swapExactTokenForPt)\b",
        search,
    ))


def _pool_cluster(
    custody: Optional[Iterable[str]],
    names: set[str],
) -> bool:
    """True when lifted movers look like a custody AMM, not token admin.

    Live Uni V3 Pool movers: mint / collect / burn / swap / flash /
    collectProtocol. mint+burn alone is USDC-style admin — require a
    reserve verb. Do not use imported extra_names (SwapRouter blobs
    include IUniswapV3Pool.swap/mint).
    """
    movers = {str(n).lower() for n in (custody or []) if n}
    if not movers:
        return False
    hits = movers & POOL_MOVER_NAMES
    return bool(hits & POOL_RESERVE_VERBS) and len(hits) >= 2


def _is_router(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> bool:
    """Pass-through swap router, not an AMM that *invokes* a callback.

    After #28, `uniswapV3SwapCallback` in ROUTER_NAMES plus the live Pool
    blob (IUniswapV3SwapCallback + `IUniswapV3SwapCallback(msg.sender)…`)
    made `_is_router` true. Combined with `not _is_router` on the pool
    family and `_hold_signal(include_amm=False)` on passthrough, the
    USDC/WETH 0.05% pool (`0x88e6…5640`) demoted as `router`. Callback
    names are shared; unique exactInput verbs are not.
    """
    if _own_reserves(src, names, focus):
        return False
    if _unique_router(src, names, custody, focus):
        return True
    if _pool_cluster(custody, names):
        return False
    probe = _probe_names(src, names, custody, focus)
    return bool(probe & ROUTER_CALLBACK_NAMES)


def _is_nft_market(src: str, names: set[str]) -> bool:
    if names & NFT_MARKET_NAMES:
        return True
    return bool(re.search(
        r"\b(fulfill(Basic)?Order|fulfillAvailable(Advanced)?Orders|match(Advanced)?Orders|"
        r"atomicMatch_?|takeAsk|takeBid|settleOrder|buyItem)\b",
        src,
    ))


def _nft_escrow(src: str, names: set[str]) -> bool:
    if names & ESCROW_NAMES:
        return True
    return bool(re.search(
        r"\b(pendingPayment|escrowBalance|depositETH|withdrawETH|depositWETH)\b",
        src,
    ))


def _hold_signal(
    src: str,
    names: set[str],
    *,
    include_amm: bool = True,
    focus: Optional[str] = None,
) -> bool:
    """True when the source shows share / reserve / stake / vault accounting.

    `include_amm=False` ignores imported pool interfaces (`slot0` / `getReserves`)
    so a SwapRouter that embeds IUniswapV3Pool is not treated as a reserve venue.
    """
    hold_names = {
        "totalassets", "converttoshares", "converttoassets",
        "previewdeposit", "previewmint", "previewwithdraw", "previewredeem",
        "pricepershare", "getpriceperfullshare",
        "exchangeratestored", "exchangeratecurrent",
        "stakingtoken", "rewardstoken", "rewardtoken", "earned", "getreward",
        "add_liquidity", "remove_liquidity", "addliquidity", "removeliquidity",
        "accrueinterest", "liquidationcall",
        "getpooledethbyshares", "getsharesbypooledeth",
        "joinpool", "exitpool",
        "stake", "unstake",
    }
    if include_amm:
        hold_names = set(hold_names) | {"getreserves", "slot0", "reserve0", "reserve1"}
    declared = _contract_declared_names(src, focus)
    pool = declared if declared else names
    if pool & hold_names:
        return True
    search = _contract_bodies(src, focus) or src
    pats = (
        r"\b(totalAssets|convertToShares|convertToAssets|pricePerShare|"
        r"getPricePerFullShare|exchangeRateStored|stakingToken|getReward|"
        r"getPooledEthByShares|joinPool|exitPool|accrueInterest)\b"
    )
    if include_amm:
        pats = (
            r"\b(totalAssets|convertToShares|convertToAssets|pricePerShare|"
            r"getPricePerFullShare|exchangeRateStored|stakingToken|getReward|"
            r"uint\d*\s+(?:public\s+|private\s+|internal\s+)?(reserve0|reserve1)|"
            r"getPooledEthByShares|joinPool|exitPool|accrueInterest)\b"
        )
    return bool(re.search(pats, search))


def _reserve_storage(text: str) -> bool:
    if re.search(
        r"\b(struct\s+Slot0|Slot0\s+public\s+(?:override\s+)?slot0|"
        r"uint128\s+public\s+(?:override\s+)?liquidity)\b",
        text,
    ):
        return True
    return bool(re.search(
        r"\buint\d*\s+(?:public\s+|private\s+|internal\s+|override\s+)+(?:_?reserve[01]|liquidity)\b",
        text,
    ))


def _own_reserves(src: str, names: set[str], focus: Optional[str] = None) -> bool:
    """AMM reserve surface on *this* contract, not an imported pool interface.

    A router file often embeds `function slot0` on IUniswapV3Pool. That is
    not this contract holding reserves. Do **not** treat imported `slot0`
    in the global name set as own reserves — that is how SwapRouter extra
    names looked like a pool after #27.

    Live Uni V3 *Pool* (`0x88e6…5640`) stores `Slot0 public override slot0`
    and `uint128 public override liquidity`. Those are not `function slot0(`
    so `_FN_NAME` / the old visibility regex missed them. Prefer the pool
    tag; custody keep is OK.
    """
    implemented = _contract_declared_names(src, focus)
    if implemented:
        if {"getreserves", "slot0", "reserve0", "reserve1", "liquidity"} & implemented:
            return True
        return _reserve_storage(_contract_bodies(src, focus))
    # No contract blocks (IR-only / raw JSON). Do not trust `slot0` in the
    # collected name set — SwapRouter extra_names include the pool iface.
    # V2-shaped reserve0/getReserves in names is still a keep.
    if {"reserve0", "reserve1", "getreserves"} & names:
        return True
    return _reserve_storage(src or "")


def _is_pool_addresses_provider(
    src: str,
    names: set[str],
    focus: Optional[str] = None,
) -> bool:
    """Aave / Spark address registry — not a diamond and not a hold."""
    declared = _this_or_names(src, names, focus)
    probe = _probe_names(src, names, None, focus)
    if not ({"getpool", "getaclmanager"} <= declared):
        return False
    if not ({"setpoolimpl", "setaddress"} & (declared | probe)):
        return False
    return not _hold_signal(src, names, include_amm=False, focus=focus)


def _passthrough_family(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> tuple[str, list[str]]:
    """Pass-through surfaces that do not hold third-party funds."""
    if _is_nft_market(src, names) and not _nft_escrow(src, names):
        return "nft-market", ["atomic-nft-market"]
    # Aave / Spark WrappedTokenGateway: wrap+supply / unwrap+withdraw.
    # ETH does not sit here — it is forwarded to the pool.
    declared = _this_or_names(src, names, focus)
    probe = _probe_names(src, names, custody, focus)
    if (
        {"depositeth", "borroweth", "repayeth"} <= (declared | probe)
        and {"getwethaddress", "withdraweth"} & (declared | probe | names)
        and not _own_reserves(src, names, focus)
    ):
        return "router", ["weth-gateway"]
    # CoW GPv2Settlement: atomic batch settle. Tokens flash through;
    # they do not sit. Uni V4 PoolManager has settle+swap but not this.
    if (
        {"invalidateorder"} & (declared | probe | names)
        and {"settle"} & (declared | probe)
        and not _own_reserves(src, names, focus)
    ):
        return "router", ["cow-settlement"]
    # Sky DaiUsds: 1:1 converter through the Joins. Nothing sits here.
    if {"daitousds", "usdstodai"} <= (declared | probe) and not _own_reserves(src, names, focus):
        return "router", ["dai-usds-converter"]
    # Compound III CometRewards: COMP faucet. claim/withdrawToken are not a
    # lending hold. Sibling Comet.sol in the Sourcify tree must not promote.
    if (
        {"getrewardowed", "claim"} <= (declared | probe)
        and {"claimto", "withdrawtoken"} & (declared | probe)
        and not _own_reserves(src, names, focus)
    ):
        return "router", ["comet-rewards"]
    # Maple SyrupRouter (`0x134c…df76`): permissioned entry. Pulls assets,
    # deposits into MaplePool, routes shares back. Nothing sits here.
    if (
        {"authorizeanddeposit"} & (declared | probe)
        and {"depositwithpermit", "authorizeanddepositwithpermit"} & (declared | probe)
        and not _own_reserves(src, names, focus)
    ):
        return "router", ["maple-syrup-router"]
    # Stargate V2 TokenMessaging (`0x6d66…A980`): bus/taxi packets only.
    # Liquidity sits on StargatePool (`addTreasuryFee`). Messaging also
    # exposes `rideBus` (ticket enqueue) — that is not a lock.
    if (
        {"drivebus"} & (declared | probe)
        and {"checktickets", "encodetaxi", "encodebus"} & (declared | probe)
        and "addtreasuryfee" not in (declared | probe)
        and not _own_reserves(src, names, focus)
    ):
        return "router", ["stargate-token-messaging"]
    if _unique_router(src, names, custody, focus) and not _own_reserves(src, names, focus):
        return "router", ["passthrough-router"]
    if _is_router(src, names, custody, focus) and not _hold_signal(src, names, include_amm=False, focus=focus):
        return "router", ["passthrough-router"]
    return "", []


def _hybrid_hold(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> tuple[str, list[str]]:
    """Looser hold check used after ERC-20 shape so hybrids are not demoted."""
    return _funds_at_risk_family(src, names, custody, focus)


def _this_or_names(src: str, names: set[str], focus: Optional[str] = None) -> set[str]:
    """Prefer names this contract implements. Fall back for IR-only / Vyper."""
    implemented = _contract_declared_names(src, focus)
    return implemented if implemented else set(names)


def _family_search(src: str, focus: Optional[str] = None) -> str:
    """Regex surface for family tags — *contract* bodies, not imported ifaces.

    Live swETH / rswETH blobs include `interface { function finalizeWithdrawal; }`
    and used to win as bridge via a full-source search. Prefer the focused
    contract + parents; else every `contract` body. Fall back to raw `src`
    only when there are no type blocks (IR-only / Vyper / JSON).
    """
    focused = _contract_bodies(src, focus)
    if focused:
        return focused
    all_bodies = _contract_bodies(src)
    if all_bodies:
        return all_bodies
    return src or ""


def _is_share_wrap(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> bool:
    """wstETH-shaped wrap of a share token. Money sits in Lido / the inner token.

    Live wstETH movers are wrap / unwrap / receive. The flattened blob also
    *calls* `stETH.getPooledEthByShares`, which used to fire Lido staking.
    Token-to-token wrap/unwrap is *not* WETH-shaped, so IR tags those movers
    as custody — that is how weETH (`0xCd5f…b7ee`) false-kept. Named rate
    converters *or* wrap/unwrap as the only non-admin movers catch that class
    (rsETH / ezETH / cbETH wraps included). cbETH StakedTokenV1 is an oracle
    exchangeRate wrap with no on-chain wrap/unwrap.
    """
    declared = _contract_declared_names(src, focus)
    # Real Lido stETH implements submit + getPooledEthByShares here.
    if declared and {"getpooledethbyshares", "submit"} & declared:
        return False
    # Compound / lending share tokens are venues, not wraps.
    if declared and {"borrow", "repay", "accrueinterest", "repayborrow"} & declared:
        return False

    probe = _probe_names(src, names, custody, focus) | _this_or_names(src, names, focus)
    movers = {str(n).lower() for n in (custody or []) if n}
    # Global names include imported IWstETH.unwrap / getWstETHByStETH on
    # Lido WithdrawalQueue — only *this* contract's wrap/rate counts.
    wrap_pool = probe | movers | (declared if declared else set())
    has_wrap = bool(_SHARE_WRAP_MOVERS & wrap_pool)
    rate_pool = declared if declared else names
    rate = bool(SHARE_WRAP_NAMES & rate_pool) or bool(
        _SHARE_WRAP_RATE_RX.search(_family_search(src, focus))
    )
    if has_wrap and rate:
        return True
    # wrap/unwrap as the only non-admin custody movers — weETH-class share wrap
    # even when the rate getter name is new / missing.
    if has_wrap and movers:
        extra = {m for m in movers if m not in _SHARE_WRAP_MOVERS and not _is_token_admin(m)}
        if not extra:
            return True
    return _is_oracle_staked_wrap(src, names, focus)


def _is_oracle_staked_wrap(
    src: str,
    names: set[str],
    focus: Optional[str] = None,
) -> bool:
    """cbETH StakedTokenV1: FiatToken + oracle `exchangeRate` / `updateExchangeRate`.

    Coinbase holds the ETH off-chain. This address is a wrap-token, not a vault.
    Compound uses `exchangeRateStored` / `exchangeRateCurrent` + accrue — skip.
    """
    pool = _this_or_names(src, names, focus)
    if "exchangerate" not in pool:
        return False
    if not ({"updateexchangerate", "updateoracle"} & (pool | names)):
        return False
    if {"exchangeratestored", "exchangeratecurrent", "accrueinterest"} & pool:
        return False
    return True


def _is_erc4626(src: str, names: set[str], focus: Optional[str] = None) -> bool:
    """ERC-4626 surface on *this* contract.

    Live Morpho Blue (`0xBBBB…FFCb`) was tagged vault because SharesMathLib
    uses `totalAssets` as a *parameter*. Require a 4626 verb, not a bare word.
    Sourcify trees may include IERC4626 / SY on a sibling — prefer focused
    contract bodies when Etherscan named the primary.
    """
    declared = _contract_declared_names(src, focus)
    pool = declared if declared else names
    if {"converttoshares", "converttoassets", "previewdeposit", "previewredeem"} & pool:
        return True
    search = _contract_bodies(src, focus) or src
    return bool(re.search(
        r"\b(ERC4626|function\s+convertToShares|function\s+convertToAssets|"
        r"function\s+totalAssets|function\s+previewDeposit)\b",
        search,
    ))


def _split_4626_and_lending_tree(src: str, lending_needles: set[str]) -> bool:
    """True when the blob has a 4626-only contract and a separate lending contract."""
    vault_only = False
    lending_only = False
    for kind, _name, body in _type_blocks(src):
        if kind != "contract":
            continue
        fns = {n.lower() for n in _FN_NAME.findall(body)}
        lending = bool(lending_needles & fns)
        vaultish = bool(
            {"converttoshares", "converttoassets", "previewdeposit", "previewredeem", "totalassets"}
            & fns
        )
        if vaultish and not lending:
            vault_only = True
        if lending and not vaultish:
            lending_only = True
    return vault_only and lending_only


def _funds_at_risk_family(
    src: str,
    names: set[str],
    custody: Optional[Iterable[str]] = None,
    focus: Optional[str] = None,
) -> tuple[str, list[str]]:
    """Most-specific venue that regularly holds or accounts third-party value.

    Flash-loan alone is not lending. A swap-router is not a pool. Prefer
    false keep when a real hold/share/reserve/stake signal is present.
    Imported callback ifaces on a reserve AMM are a keep, not a router.
    """
    signals: list[str] = []
    movers = {str(n).lower() for n in (custody or []) if n}
    declared = _this_or_names(src, names, focus)
    probe = _probe_names(src, names, custody, focus)
    lending_search = _contract_bodies(src, focus) or (
        _contract_bodies(src) if _contract_declared_names(src) else src
    )

    # Liquity V2 StabilityPool (`0x5721…f9bf` WETH branch): depositors'
    # BOLD sits here and is offset against liquidations. V1 uses the same
    # verbs. Not a pass-through.
    if (
        {"providetosp", "withdrawfromsp"} <= (declared | probe)
        and {"offset"} & (declared | probe | names)
    ):
        return "vault", ["liquity-stability-pool"]
    # Maker / Sky LitePSM: sellGem/buyGem hold DAI + gem. Same-file Vat
    # `function frob` must not steal the family (live DssLitePsm flatten).
    if {"sellgem", "buygem"} <= (declared | probe | names):
        return "vault", ["maker-psm"]
    # Maker / Sky Join adapters hold the gem/DAI/USDS. DaiJoin/GemJoin
    # have cage; UsdsJoin (`0x3C0f…7FEB`) does not — require *this*
    # contract's vat (not PotLike.vat on DsrManager) plus a join token.
    # Do not steal Pot (dsr/chi/pie). DsrManager stays generic custody.
    if (
        {"join", "exit"} <= (declared | probe)
        and {"vat"} & (declared | probe)
        and not ({"dsr", "chi", "pie"} <= (declared | names))
        and {"usds", "dai", "gem", "cage"} & (declared | probe | names)
    ):
        return "vault", ["maker-join"]
    # Vat verbs only. Dai (`0x6B17…1d0F`) also has `modifier auth` + `wards`
    # and used to win as maker. Prefer false keep for a real Vat (has frob).
    maker = bool(VAT_VERBS & (declared | probe)) or bool(re.search(
        r"\bfunction\s+(frob|flux|suck|grab|heal|fold|slip)\s*\(",
        _contract_bodies(src, focus) or src,
    ))
    if maker:
        return "maker", ["maker-vat/wards"]
    # Sky / Maker Pot: DSR pie accounting. join/exit hold DAI in Vat.
    if {"join", "exit"} <= (declared | probe) and {"dsr", "chi", "pie"} <= (declared | names):
        return "vault", ["maker-pot"]
    # Stargate V2 TokenMessaging is lzReceive + driveBus — not a lock.
    # Pools that actually hold (`addTreasuryFee`) stay bridge. Messaging
    # also exposes `rideBus` (ticket enqueue) so that verb is not a hold.
    stargate_msg_only = (
        bool({"drivebus"} & (declared | probe))
        and bool({"checktickets", "encodetaxi", "encodebus"} & (declared | probe))
        and "addtreasuryfee" not in (declared | probe)
    )

    # Fluid Liquidity dummy / user module: operate is supply+borrow+withdraw.
    # Etherscan Implementation is DummyImpl (ABI surface); money sits on the proxy.
    if {"operate", "operateonbehalfof"} <= (declared | names) and bool(
        re.search(
            r"\b(supplyAmount_|borrowAmount_|updateUserBorrowConfigs|FluidLiquidity)\b",
            _family_search(src, focus),
        )
    ):
        return "lending", ["fluid-liquidity"]

    if not stargate_msg_only and (
        (probe | declared | (set() if movers else names)) & BRIDGE_NAMES
        or re.search(
            r"\b(lzReceive|finalizeWithdrawalTransaction\w*|proveWithdrawalTransaction\w*|"
            r"finalizeWithdrawal\b|proveWithdrawal\b|bridgeMint|"
            r"depositV3|fillV3Relay|fillRelay|relayTokens|proposeRootBundle|"
            r"SpokePool|HubPool|claimRelayerRefund|"
            r"sendToL2|bondTransferRoot|confirmTransferRoot|challengeTransferRoot|"
            r"bondWithdrawal\w*|settleBondedWithdrawal\w*|"
            r"depositTransaction|OptimismPortal|"
            r"finalizeETHWithdrawal|finalizeERC20Withdrawal|finalizeBridgeETH|finalizeBridgeERC20|"
            r"finalizeWithdrawETH|finalizeWithdrawERC20|"
            r"bridgeETH\w*|bridgeERC20\w*|"
            r"createRetryableTicket|unsafeCreateRetryableTicket|depositEtherFor|"
            r"lockTokens|exitTokens|function\s+depositEther|"
            r"relayMessageWithProof|depositWithMessage|"
            r"requestL2Transaction|bridgehubRequestL2Transaction|finalizeEthWithdrawal|"
            r"receiveMessage|_processMessageFromChild)\b",
            _family_search(src, focus),
        )
        or (
            {"maptoken"} & (declared | probe | names)
            and {"deposit", "depositether"} & (declared | probe | names)
            and {"receivemessage", "processmessagefromchild"} & (declared | names)
        )
    ):
        return "bridge", ["bridge-surface"]

    # Lending before generic 4626: Morpho Blue has borrow/liquidate *and*
    # a SharesMathLib `totalAssets` parameter that used to win as vault.
    # Live MetaMorpho (`0xBEEF…64CB`) Sourcify-trees include Morpho.sol —
    # do not union sibling `contract` bodies or leaked movers.
    lending_needles = {
        "borrow", "repay", "repayborrow", "liquidationcall", "liquidate", "liquidateborrow",
    }
    if movers:
        # This-address movers, intersected with the primary when we have one.
        here = (movers & declared) if (focus and declared) else movers
        lending_ix = bool(lending_needles & here)
        src_rx = ""
    else:
        here = declared if declared else names
        lending_ix = bool(lending_needles & here) or bool(
            re.search(
                r"\b(function\s+borrow|function\s+repay|liquidationCall|LendingPool|"
                r"executeSupply|repayBorrow|function\s+liquidate)\b",
                lending_search,
            )
        )
        src_rx = lending_search
    # Sourcify trees ship a 4626-only MetaMorpho *and* sibling Morpho.sol.
    # Union movers then look like Morpho Blue (borrow+repay). Split-contract
    # blobs without a primary name prefer the 4626 vault. A single Morpho /
    # Aave / cToken contract has no 4626-only sibling and stays lending.
    if lending_ix and not focus and _split_4626_and_lending_tree(src, lending_needles):
        lending_ix = False
    # Same-contract leak: 4626 deposit/redeem plus borrowed `borrow` name,
    # no repay/accrue on this mover set.
    if (
        lending_ix
        and _is_erc4626(src, names, focus)
        and {"deposit", "mint", "withdraw", "redeem"} & here
        and not ({"repay", "repayborrow", "accrueinterest", "liquidationcall"} & here)
    ):
        lending_ix = False
    flash = "flashloan" in here or bool(src_rx and re.search(r"\bflashLoan\s*\(", lending_search))
    aave_supply = "supply" in here or bool(src_rx and re.search(r"\bfunction\s+supply\s*\(", lending_search))
    # mint+redeem on a 4626 plus sibling Morpho.borrow is not a cToken.
    compound = False
    if {"mint", "redeem"} <= here:
        same = False
        for kind, _n, body in _type_blocks(src):
            if kind != "contract":
                continue
            fns = {n.lower() for n in _FN_NAME.findall(body)}
            if {"mint", "redeem"} <= fns and (
                {"borrow", "repayborrow", "accrueinterest"} & fns
            ):
                same = True
                break
        compound = same or bool(
            src_rx and re.search(r"\b(exchangeRateStored|accrueInterest)\b", lending_search)
        )
    comet = bool({"supply", "withdraw"} & here) and bool(
        COMET_NAMES & here
        or (src_rx and re.search(r"\b(function\s+absorb|buyCollateral|borrowBalanceOf|accrueAccount)\b", lending_search))
    )
    join_exit = bool({"joinpool", "exitpool"} & here) or bool(
        src_rx and re.search(r"\b(joinPool|exitPool)\b", lending_search or src)
    )
    liquity_bo = bool(
        {"opentrove", "adjusttrove", "withdrawcoll", "addcoll"} & (declared | probe | here)
    )
    # Liquity V2 TroveManager (`0x7bcb…Cf5A` WETH). V1 uses liquidate;
    # V2 uses batchLiquidateTroves + onOpenTrove / redeemCollateral.
    liquity_v2 = bool({"batchliquidatetroves"} & (declared | probe | here)) and bool(
        {"redeemcollateral", "urgentredemption", "onopentrove"} & (declared | probe | here)
    )
    gearbox = bool({"opencreditaccount", "closecreditaccount"} & (declared | probe | here)) and bool(
        {"managedebt", "addcollateral", "withdrawcollateral", "liquidatecreditaccount"}
        & (declared | probe | here | names)
    )
    if lending_ix or compound or comet or liquity_bo or liquity_v2 or gearbox or (
        flash and (aave_supply or "deposit" in here) and not join_exit
    ):
        if gearbox and not lending_ix:
            return "lending", ["gearbox-credit"]
        if liquity_v2 and not lending_ix:
            return "lending", ["liquity-v2-trove"]
        if liquity_bo and not lending_ix:
            return "lending", ["liquity-borrower"]
        if comet and not lending_ix:
            return "lending", ["compound-comet"]
        if compound and not lending_ix:
            return "lending", ["compound-ctoken"]
        return "lending", ["lending-ix"] if lending_ix else ["flash+supply/deposit"]

    # Pendle Action* / Uni V2 Router02: unique pass-through verbs beat imported
    # ERC-4626 / SY ifaces in the diamond or periphery blob.
    if _unique_router(src, names, custody, focus) and not _own_reserves(src, names, focus):
        return "", []

    # Enzyme VaultLib (`0x891d…8A38`): tracked-asset vault. withdrawAssetTo
    # + buybackProtocolFeeShares are unique — not a generic deposit/withdraw.
    if {"withdrawassetto", "buybackprotocolfeeshares"} <= (declared | probe):
        return "vault", ["enzyme-vault"]
    # Origin OETH vault impl (`0x0E97…e575`). Async queue + rebase/allocate.
    # Must not be stolen by Lido WQ (`requestWithdrawal` singular vs plural).
    if (
        {"requestwithdrawal", "addwithdrawalqueueliquidity"} <= (declared | probe)
        and {"rebase", "allocate"} & (declared | probe)
    ):
        return "vault", ["origin-oeth-vault"]
    erc4626 = _is_erc4626(src, names, focus)
    # Live Yearn yvUSDC tagged share-accounting: `uint256 public pricePerShare`
    # (and Vyper `pricePerShare: public`) is a getter, not `function pricePerShare`.
    yearn = bool(YEARN_SHARE_NAMES & (declared | names)) or bool(re.search(
        r"\b(pricePerShare|getPricePerFullShare|price_per_share|get_price_per_full_share)\b",
        _contract_bodies(src, focus) or src,
    ))
    # `totalShares` + imported IStrategy.deposit used to tag Eigen Delegation
    # as vault. Require this-contract deposit/withdraw/redeem.
    share_acct = bool({"totalshares", "converttoshares", "pricepershare"} & declared) or bool(
        re.search(
            r"\bfunction\s+(totalShares|convertToShares|pricePerShare)\b",
            _contract_bodies(src, focus) or src,
        )
    )
    has_dw = bool({"deposit", "withdraw", "redeem"} & declared)
    if join_exit or erc4626 or yearn or (share_acct and has_dw):
        if join_exit:
            signals.append("join/exit")
        elif erc4626:
            signals.append("erc4626")
        elif yearn:
            signals.append("yearn-share-price")
        else:
            signals.append("share-accounting")
        return "vault", signals or ["vault"]
    if _is_nft_market(src, names) and _nft_escrow(src, names):
        return "vault", ["nft-escrow"]

    # GLP vault is Arbitrum-first. Require *this* contract's verbs — do not
    # search the full blob (imported IVault on the ETH GMX token is not a vault).
    gmx_search = _contract_bodies(src, focus) or ""
    if (probe | declared) & GMX_NAMES or (
        gmx_search
        and bool(re.search(
            r"\b(function\s+buyUSDG|function\s+sellUSDG|function\s+increasePosition|guaranteedUsd)\b",
            gmx_search,
        ))
    ):
        return "vault", ["gmx-glp-vault"]

    staking_ix = bool({"stake", "unstake", "getreward"} & (declared | probe)) or bool(
        re.search(
            r"\b(function\s+stake|function\s+unstake|function\s+getReward|stakingToken)\b",
            _family_search(src, focus),
        )
    )
    masterchef = bool(re.search(
        r"\b(poolInfo|userInfo|MasterChef|pendingSushi|pendingRewards)\b",
        _family_search(src, focus),
    )) and ("deposit" in (declared | probe) or "withdraw" in (declared | probe))
    convex = bool((probe | declared) & CONVEX_NAMES) or bool(re.search(
        r"\b(function\s+earmarkRewards|function\s+earmarkFees)\b",
        _family_search(src, focus),
    ))
    # Live wstETH *calls* stETH.getPooledEthByShares — require it *here*.
    lido = bool({"getpooledethbyshares", "getsharesbypooledeth", "submit"} & declared) or (
        not _contract_declared_names(src, focus)
        and bool(re.search(r"\bfunction\s+(getPooledEthByShares|submit)\b", src))
    )
    # Live rswETH flatten ships IDelegationManager with queueWithdrawals —
    # search *contract* bodies, not imported ifaces (same as swETH finalizeWithdrawal).
    eigen = bool((probe | declared) & EIGEN_NAMES) or bool(re.search(
        r"\b(function\s+depositIntoStrategy|function\s+queueWithdrawals|"
        r"function\s+completeQueuedWithdrawal|function\s+undelegate)\b",
        _family_search(src, focus),
    ))
    gauge = bool(CURVE_GAUGE_NAMES & (declared | probe | names)) or (
        {"deposit", "withdraw"} <= (declared | probe | names)
        and bool({"claimable_tokens", "claimable_reward", "integrate_fraction"} & (declared | names))
    )
    # Kelp LRTDepositPool (`depositAsset` + `getRsETHAmountToMint`) holds LSTs.
    # The rsETH *token* only mints/burns — require *this* contract.
    lrt_here = declared if (focus and declared) else (declared | probe)
    lrt_pool = bool({"depositasset"} & lrt_here) and bool(
        {"getrsethamounttomint", "gettotalassetdeposits", "getassetcurrentlimit"}
        & (lrt_here | (set() if (focus and declared) else names))
        or (
            not (focus and declared)
            and re.search(
                r"\b(getRsETHAmountToMint|getTotalAssetDeposits|function\s+depositAsset)\b",
                _family_search(src, focus),
            )
        )
    )
    rocket = bool(ROCKET_RETH_NAMES & declared) and bool(
        {"burn", "depositexcess"} & (declared | probe)
    )
    rocket_dp = bool({"deposit"} & (declared | probe)) and bool(
        {"assigndeposits", "receivevaultwithdrawaleth", "recycleliquidatedstake"}
        & (declared | names)
    )
    # Lido WithdrawalQueue holds unstETH claims — not a wstETH wrap.
    # Require *this* contract's plural `requestWithdrawals` + finalize/enqueue.
    # Origin OETH vault uses singular `requestWithdrawal` + rebase (vault).
    lido_wq = bool({"requestwithdrawals"} & (declared | probe)) and bool(
        {"finalize", "_enqueue"} & (declared | probe)
    )
    # Renzo RestakeManager holds collaterals for ezETH.
    renzo = bool({"depositeth", "deposit"} & (declared | probe)) and bool(
        {"ezeth", "operatordelegator", "renzooracle"} & (declared | names)
    )
    swell = bool({"deposit", "depositwithreferral"} & (declared | probe)) and bool(
        SWELL_LST_NAMES & (declared | names)
    )
    synth_rewards = bool({"deposit", "withdraw"} <= (declared | probe | names)) and bool(
        {"earned", "getreward", "rewardpertoken"} & (declared | probe | names)
    )
    if staking_ix or masterchef or lido or eigen or convex or lrt_pool or rocket or rocket_dp or lido_wq or renzo or swell or synth_rewards or gauge:
        if eigen:
            return "staking", ["eigenlayer"]
        if lido:
            return "staking", ["lido-pooled-eth"]
        if rocket:
            return "staking", ["rocket-reth"]
        if rocket_dp:
            return "staking", ["rocket-deposit-pool"]
        if lido_wq:
            return "staking", ["lido-withdrawal-queue"]
        if renzo:
            return "staking", ["renzo-restake"]
        if swell:
            return "staking", ["swell-lst"]
        if convex:
            return "staking", ["convex-booster"]
        if lrt_pool:
            return "staking", ["lrt-deposit-pool"]
        if masterchef:
            return "staking", ["masterchef"]
        if gauge:
            return "staking", ["curve-gauge"]
        return "staking", ["stake/reward"]

    curve = bool({"add_liquidity", "remove_liquidity", "exchange"} & (declared | probe | names)) or bool(
        re.search(r"\b(add_liquidity|remove_liquidity)\s*\(", _family_search(src, focus))
    )
    if curve:
        return "pool", ["curve-pool"]
    pendle_here = (declared | probe) if (declared or probe) else names
    pendle_mkt = bool(PENDLE_MARKET_NAMES & pendle_here) and not _unique_router(
        src, names, custody, focus,
    )
    if pendle_mkt and (
        {"swapexactptforsy", "swapsyforexactpt", "swapexactsyforpt"} & pendle_here
        or ({"readstate", "readtokens"} & pendle_here and {"mint", "burn", "skim"} & pendle_here)
    ):
        return "pool", ["pendle-market"]
    # Uni V2 Router02 (`0x7a25…488D`) has addLiquidity + swapExact* — that is
    # pass-through, not a reserve AMM. Unique router verbs beat pool-cluster.
    if _unique_router(src, names, custody, focus) and not _own_reserves(src, names, focus):
        return "", []
    # Custody AMM movers beat imported callback-iface "router" names.
    if _pool_cluster(custody, names):
        return "pool", ["amm-pool-movers"]
    has_swap = "swap" in _probe_names(src, names, custody, focus) or bool(
        re.search(r"\bfunction\s+swap\s*\(", _contract_bodies(src, focus) or src)
    )
    if has_swap and _own_reserves(src, names, focus) and not _unique_router(src, names, custody, focus):
        return "pool", ["amm-reserves"]

    # Ungated ETH piggy-bank: *this* contract withdraws address(this).balance
    # and is not WETH. Do not fire on a SwapRouter that imports IWETH9.withdraw
    # and refunds leftover ETH in `refundETH` (`address(this).balance`).
    implemented = _contract_declared_names(src, focus)
    if (
        "withdraw" in names
        and re.search(r"address\s*\(\s*this\s*\)\s*\.balance", _family_search(src, focus))
        and not _weth_shape(src, names, focus)
        and not _unique_router(src, names, custody, focus)
        and (not implemented or "withdraw" in implemented)
    ):
        return "vault", ["eth-custody-withdraw"]

    return "", []
