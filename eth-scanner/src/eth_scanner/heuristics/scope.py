"""Lane-A scope filter — regularity, not a funds-at-risk oracle.

Plain ERC-20 / wrap / admin-token surfaces do not repay deep work.
In-scope classes are contracts that regularly hold or route *other
people's* value: lending, vaults, pools, routers, DEXes, bridges,
Maker-like accounting engines.

This is a picker/filter. It never stamps yes/no. Ambiguous *non-token*
surfaces stay on the main path (Do Not Auto-Dismiss).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# Classes that merit Lane B (interesting value-moving regularity).
PROMOTE_CLASSES = frozenset({
    "lending", "router", "vault", "pool", "dex", "bridge", "maker",
})
# Cool-archive. High TVL must not promote these — USDC/USDT are still tokens.
DEMOTE_CLASSES = frozenset({"token", "wrap-token"})

ERC20_INTERFACE = (
    "transfer", "approve", "transferfrom", "balanceof", "allowance", "totalsupply",
)
ERC20_META = ("name", "symbol", "decimals")
ERC721_INTERFACE = (
    "ownerof", "safetransferfrom", "setapprovalforall", "tokenuri", "balanceof",
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
# Compound admin verbs (rescueERC20, mintTo, recoverToken). Keep tight —
# do not prefix-match generic custody names like withdraw/sweep.
TOKEN_ADMIN_PREFIXES = ("mint", "burn", "rescue", "recover")

_FN_NAME = re.compile(r"\bfunction\s+(\w+)\s*\(", re.I)
_PUBLIC_GETTER = re.compile(
    r"\b(?:mapping\s*\([^;]*\)|uint\d*|u256|int\d*|bool|address|string|bytes\d*)\s+public\s+(\w+)",
    re.I,
)


@dataclass
class ScopeDecision:
    contract_class: str
    scope: str  # in-scope | demoted-token | utility | unknown
    signals: list[str] = field(default_factory=list)
    promote: bool = False

    @property
    def demoted(self) -> bool:
        return self.scope == "demoted-token"


def classify_scope(
    *,
    source: str = "",
    functions: Optional[Iterable[Any]] = None,
    extra_names: Optional[Iterable[str]] = None,
) -> ScopeDecision:
    """Classify a contract from source text + lifted functions.

    In-scope families are checked *before* ERC-20 shape so a lending pool
    that calls `IERC20.transferFrom` is never demoted as a token.
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

    family, family_signals = _in_scope_family(src, names)
    if family:
        return ScopeDecision(
            contract_class=family,
            scope="in-scope",
            signals=family_signals,
            promote=family in PROMOTE_CLASSES,
        )

    erc20 = _interface_score(src, names, ERC20_INTERFACE)
    erc721 = _interface_score(src, names, ERC721_INTERFACE)
    token_admin_only = bool(custody) and all(_is_token_admin(n) for n in custody)
    wrap_only = wrap and all(
        roles.get(n) in {"wrap-unwrap", "erc20-standard", ""} or _is_token_admin(n)
        for n in custody
    )

    token_shaped = erc20 >= 3 or (erc20 >= 2 and _has_meta(src, names)) or (
        erc20 >= 2 and token_admin_only
    )
    if token_shaped:
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
        return ScopeDecision(
            contract_class="custody",
            scope="in-scope",
            signals=["erc20-plus-custody:%s" % ",".join(custody[:8])],
            promote=False,
        )

    if erc721 >= 3 and (not custody or token_admin_only):
        return ScopeDecision(
            contract_class="token",
            scope="demoted-token",
            signals=["erc721-interface:%d" % erc721],
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
    names.update(_FN_NAME.findall(src or ""))
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


def _in_scope_family(src: str, names: set[str]) -> tuple[str, list[str]]:
    """Most-specific interesting family first. Flash-loan alone is not lending
    when join/exit (Balancer) or a swap-router is the real surface."""
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
    if join_exit or erc4626:
        signals.append("join/exit" if join_exit else "erc4626")
        return "vault", signals or ["vault"]

    lending_ix = bool({"borrow", "repay", "liquidationcall", "liquidate"} & names) or bool(
        re.search(r"\b(function\s+borrow|function\s+repay|liquidationCall|LendingPool|executeSupply)\b", src)
    )
    flash = "flashloan" in names or bool(re.search(r"\bflashLoan\s*\(", src))
    aave_supply = "supply" in names or bool(re.search(r"\bfunction\s+supply\s*\(", src))
    if lending_ix or (flash and (aave_supply or "deposit" in names) and not join_exit):
        return "lending", ["lending-ix"] if lending_ix else ["flash+supply/deposit"]

    router = bool({"exactinput", "exactinputsingle", "exactoutput", "exactoutputsingle", "uniswapv3swapcallback"} & names) or bool(
        re.search(r"\b(exactInput(Single)?|exactOutput(Single)?|uniswapV3SwapCallback|SwapRouter)\b", src)
    )
    if router:
        return "router", ["router-swap"]

    if flash and join_exit:
        return "vault", ["flash+join"]
    if flash and ("swap" in names or bool(re.search(r"\bfunction\s+swap\s*\(", src))):
        return "dex", ["flash+swap"]

    if ("swap" in names or bool(re.search(r"\bfunction\s+swap\s*\(", src))) and re.search(
        r"\b(getReserves|slot0)\b", src
    ):
        return "pool", ["amm-swap"]

    if flash:
        return "lending", ["flash-loan-venue"]

    return "", []
