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
})
TOKEN_ADMIN_PREFIXES = ("mint", "burn", "rescue", "recover")

ROUTER_NAMES = frozenset({
    "exactinput", "exactinputsingle", "exactoutput", "exactoutputsingle",
    "uniswapv3swapcallback",
    "swapexacttokensfortokens", "swapexactethfortokens", "swapexacttokensforeth",
    "swaptokensforexacttokens", "unoswap", "clipperswap", "uniswapv2call",
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
_PUBLIC_GETTER = re.compile(
    r"\b(?:mapping\s*\([^;]*\)|uint\d*|u256|int\d*|bool|address|string|bytes\d*)\s+public\s+(\w+)",
    re.I,
)


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
) -> ScopeDecision:
    """Classify a contract from source text + lifted functions.

    Funds-at-risk families are checked *before* ERC-20 / ERC-721 shape so a
    vault, cToken, Curve pool, or staking token is never demoted as a token.
    """
    src = source or ""
    fns = list(functions or [])
    names = _collect_names(src, fns, extra_names)
    roles = {(getattr(fn, "name", "") or "").lower(): (getattr(fn, "role", "") or "") for fn in fns}
    custody = [
        (getattr(fn, "name", "") or "").lower()
        for fn in fns
        if getattr(fn, "is_value_mover", False)
        and getattr(fn, "exposed", False)
        and (getattr(fn, "role", "") or "custody") not in {"erc20-standard"}
    ]
    wrap = any((getattr(fn, "role", "") == "wrap-unwrap") for fn in fns) or bool(
        {"deposit", "withdraw", "wrap", "unwrap"} & names and _weth_shape(src, names)
    )

    family, family_signals = _funds_at_risk_family(src, names)
    if family:
        return ScopeDecision(
            contract_class=family,
            scope="in-scope",
            signals=family_signals,
            promote=family in FUNDS_AT_RISK_CLASSES,
        )

    erc20 = _interface_score(src, names, ERC20_INTERFACE)
    erc721 = _interface_score(src, names, ERC721_INTERFACE)
    erc1155 = _interface_score(src, names, ERC1155_INTERFACE)
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
        hybrid, hybrid_signals = _hybrid_hold(src, names)
        if hybrid:
            return ScopeDecision(
                contract_class=hybrid,
                scope="in-scope",
                signals=["hybrid-token+%s" % hybrid] + hybrid_signals,
                promote=hybrid in FUNDS_AT_RISK_CLASSES,
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
        # Prefer false keep — may be an unnamed vault.
        return ScopeDecision(
            contract_class="custody",
            scope="in-scope",
            signals=["erc20-plus-custody:%s" % ",".join(custody[:8])],
            promote=False,
        )

    passthru, pass_signals = _passthrough_family(src, names)
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

    if custody:
        # Last-chance pass-through: custody movers that are only router verbs.
        if _is_router(src, names) and not _hold_signal(src, names, include_amm=False):
            return ScopeDecision(
                contract_class="router",
                scope="demoted-passthrough",
                signals=["passthrough-router"] + ["custody-movers:%s" % ",".join(custody[:8])],
                promote=False,
            )
        flash_only = set(custody) <= {
            "flashloan", "receiveflashloan", "onflashloan", "uniswapv3flashcallback",
        }
        if flash_only and not _hold_signal(src, names):
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
    if n in TOKEN_ADMIN_NAMES:
        return True
    return any(n.startswith(p) for p in TOKEN_ADMIN_PREFIXES)


def _collect_names(src: str, fns: list[Any], extra: Optional[Iterable[str]]) -> set[str]:
    names = {(getattr(fn, "name", "") or "").lower() for fn in fns}
    names.update(n.lower() for n in _FN_NAME.findall(src or ""))
    names.update(n.lower() for n in _PUBLIC_GETTER.findall(src or ""))
    if extra:
        names.update(str(n).lower() for n in extra if n)
    return {n.lower() for n in names if n}


def _interface_score(src: str, names: set[str], interface: Iterable[str]) -> int:
    """Count *this* contract's ERC interface, not IERC20 calls on other tokens."""
    score = 0
    for item in interface:
        if item in names:
            score += 1
            continue
        if re.search(r"\bfunction\s+%s\s*\(" % re.escape(item), src, re.I):
            score += 1
            continue
        if item in {"balanceof", "allowance", "totalsupply", "name", "symbol", "decimals", "ownerof"}:
            if re.search(r"\bpublic\s+%s\b" % re.escape(item), src, re.I):
                score += 1
    return score


def _has_meta(src: str, names: set[str]) -> bool:
    return sum(1 for m in ERC20_META if m in names or re.search(r"\b%s\b" % m, src, re.I)) >= 2


def _weth_shape(src: str, names: set[str]) -> bool:
    if not ({"deposit", "withdraw", "wrap", "unwrap"} & names):
        return False
    return bool(re.search(r"balanceOf\s*\[\s*msg\.sender\s*\]\s*\+|msg\.value", src))


def _is_router(src: str, names: set[str]) -> bool:
    if names & ROUTER_NAMES:
        return True
    return bool(re.search(
        r"\b(exactInput(Single)?|exactOutput(Single)?|swapExactTokensForTokens|"
        r"SwapRouter|UniversalRouter|unoswap|clipperSwap)\b",
        src,
    ))


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


def _hold_signal(src: str, names: set[str], *, include_amm: bool = True) -> bool:
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
    if names & hold_names:
        return True
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
    return bool(re.search(pats, src))


def _own_reserves(src: str, names: set[str]) -> bool:
    """AMM reserve surface on *this* contract, not an imported pool interface.

    A router file often embeds `function slot0` on IUniswapV3Pool. That is
    not this contract holding reserves — `_is_router` gates the pool class.
    """
    if {"getreserves", "slot0", "reserve0", "reserve1"} & names:
        return True
    return bool(re.search(
        r"\buint\d*\s+(?:public\s+|private\s+|internal\s+)?(_?reserve[01]|liquidity)\b",
        src,
    ))


def _passthrough_family(src: str, names: set[str]) -> tuple[str, list[str]]:
    """Pass-through surfaces that do not hold third-party funds."""
    if _is_nft_market(src, names) and not _nft_escrow(src, names):
        return "nft-market", ["atomic-nft-market"]
    if _is_router(src, names) and not _hold_signal(src, names, include_amm=False):
        return "router", ["passthrough-router"]
    return "", []


def _hybrid_hold(src: str, names: set[str]) -> tuple[str, list[str]]:
    """Looser hold check used after ERC-20 shape so hybrids are not demoted."""
    return _funds_at_risk_family(src, names)


def _funds_at_risk_family(src: str, names: set[str]) -> tuple[str, list[str]]:
    """Most-specific venue that regularly holds or accounts third-party value.

    Flash-loan alone is not lending. A swap-router is not a pool. Prefer
    false keep when a real hold/share/reserve/stake signal is present.
    """
    signals: list[str] = []

    maker = bool({"frob", "flux", "suck", "grab", "heal", "fold", "slip"} & names) or (
        bool(re.search(r"\bmodifier\s+auth\b", src)) and bool(re.search(r"\bwards\s*\[", src))
    )
    if maker:
        return "maker", ["maker-vat/wards"]

    if re.search(r"\b(lzReceive|finalizeWithdrawal|proveWithdrawal|bridgeMint|l1Bridge|l2Bridge)\b", src):
        return "bridge", ["bridge-surface"]

    join_exit = bool({"joinpool", "exitpool"} & names) or bool(re.search(r"\b(joinPool|exitPool)\b", src))
    erc4626 = bool(re.search(r"\b(ERC4626|convertToShares|convertToAssets|totalAssets)\b", src))
    yearn = bool(re.search(r"\b(pricePerShare|getPricePerFullShare)\b", src))
    share_acct = bool(re.search(r"\b(totalShares|convertToShares|pricePerShare)\b", src))
    has_dw = bool({"deposit", "withdraw", "redeem"} & names)
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

    lending_ix = bool({"borrow", "repay", "repayborrow", "liquidationcall", "liquidate", "liquidateborrow"} & names) or bool(
        re.search(r"\b(function\s+borrow|function\s+repay|liquidationCall|LendingPool|executeSupply|repayBorrow)\b", src)
    )
    flash = "flashloan" in names or bool(re.search(r"\bflashLoan\s*\(", src))
    aave_supply = "supply" in names or bool(re.search(r"\bfunction\s+supply\s*\(", src))
    compound = (
        {"mint", "redeem"} <= names
        and (
            bool({"borrow", "repayborrow", "accrueinterest"} & names)
            or bool(re.search(r"\b(exchangeRateStored|accrueInterest)\b", src))
        )
    )
    if lending_ix or compound or (flash and (aave_supply or "deposit" in names) and not join_exit):
        if compound and not lending_ix:
            return "lending", ["compound-ctoken"]
        return "lending", ["lending-ix"] if lending_ix else ["flash+supply/deposit"]

    staking_ix = bool({"stake", "unstake", "getreward"} & names) or bool(
        re.search(r"\b(function\s+stake|function\s+unstake|function\s+getReward|stakingToken)\b", src)
    )
    masterchef = bool(re.search(r"\b(poolInfo|userInfo|MasterChef|pendingSushi|pendingRewards)\b", src)) and (
        "deposit" in names or "withdraw" in names
    )
    lido = bool(re.search(r"\b(getPooledEthByShares|getSharesByPooledEth)\b", src))
    synth_rewards = bool({"deposit", "withdraw"} <= names) and bool({"earned", "getreward", "rewardpertoken"} & names)
    if staking_ix or masterchef or lido or synth_rewards:
        if lido:
            return "staking", ["lido-pooled-eth"]
        if masterchef:
            return "staking", ["masterchef"]
        return "staking", ["stake/reward"]

    curve = bool({"add_liquidity", "remove_liquidity", "exchange"} & names) or bool(
        re.search(r"\b(add_liquidity|remove_liquidity)\s*\(", src)
    )
    has_swap = "swap" in names or bool(re.search(r"\bfunction\s+swap\s*\(", src))
    if curve or (has_swap and _own_reserves(src, names) and not _is_router(src, names)):
        return "pool", ["curve-pool"] if curve else ["amm-reserves"]

    # Ungated ETH piggy-bank: withdraws address(this).balance and is not WETH.
    if "withdraw" in names and re.search(r"address\s*\(\s*this\s*\)\s*\.balance", src) and not _weth_shape(src, names):
        return "vault", ["eth-custody-withdraw"]

    return "", []
