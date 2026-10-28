"""Lane-A named-pattern skim (WORKER_BRIEF / §2.2 EVM).

Hits are *leads*, never findings. A clean skim does not close a case.
"""

from __future__ import annotations

import re
from typing import Any

# Each entry: (id, description, patterns). Presence-only; no exploit logic.
EVM_PATTERN_SKIM: list[tuple[str, str, list[str]]] = [
    (
        "empty-market-inflation",
        "empty-market / exchange-rate inflation hint",
        [r"totalSupply\s*==\s*0", r"totalAssets\s*==\s*0", r"if\s*\([^)]*supply\s*==\s*0"],
    ),
    (
        "erc4626-rounding",
        "ERC4626 convert/preview surface (rounding / donation lead)",
        [r"\bconvertTo(Shares|Assets)\b", r"\bpreview(Deposit|Mint|Withdraw|Redeem)\b"],
    ),
    (
        "reentrancy-surface",
        "external call / nonReentrant surface (lead only)",
        [r"\bnonReentrant\b", r"ReentrancyGuard", r"\.call\s*\{"],
    ),
    (
        "spot-oracle",
        "spot-oracle (slot0 / reserves) hint",
        [r"\bslot0\b", r"\bgetReserves\s*\("],
    ),
    (
        "fee-on-transfer-rebase",
        "fee-on-transfer / reflection / rebase hint",
        [r"feeOnTransfer", r"\b_rOwned\b", r"\breflect\s*\(", r"\brebase\b"],
    ),
    (
        "missing-slippage",
        "swap / liquidity path — check slippage bounds by hand",
        [r"\bswap\s*\(", r"amountOutMin", r"amountInMax", r"\bdeadline\b"],
    ),
    (
        "sig-replay-eip712",
        "signature / EIP-712 domain surface",
        [r"\becrecover\s*\(", r"\bEIP712\b", r"\bnonces\s*\["],
    ),
    (
        "unchecked-call",
        "low-level call / unchecked arithmetic surface",
        [r"\.call\s*[\({]", r"\bunchecked\s*\{"],
    ),
    (
        "pre-08-overflow",
        "pre-0.8 compiler (unchecked overflow era)",
        [r"pragma\s+solidity\s+[^;]*0\.[0-7]\b"],
    ),
]

WEIRD_SIGNALS: list[tuple[str, list[str]]] = [
    ("bridge-mint-release", [r"\b(lzReceive|onRecv|proveWithdrawal|finalizeWithdrawal|bridgeMint)\b",
                             r"\b(mailbox|outbox|inbox|l1Bridge|l2Bridge|depositV3|fillV3Relay|SpokePool|HubPool)\b"]),
    ("custom-share-math", [r"\bexchangeRate\w*\b", r"\bpricePerShare\b", r"\bvirtualPrice\b"]),
    ("proxy-delegatecall", [r"\bdelegatecall\b", r"\bERC1967\b", r"\bimplementation\s*\("]),
    ("fork-family", [r"\b(Compound|Aave|Uniswap|ERC4626|MasterChef|CErc20|LendingPool)\b"]),
    ("first-deposit-edge", [r"totalSupply\s*==\s*0", r"if\s*\([^)]*supply\s*==\s*0"]),
]


def _hits(patterns: list[str], text: str) -> list[str]:
    found: list[str] = []
    for p in patterns:
        if re.search(p, text):
            found.append(p)
    return found


def skim_known_patterns(source: str) -> list[dict[str, Any]]:
    leads: list[dict[str, Any]] = []
    if not source:
        return leads
    for pid, desc, pats in EVM_PATTERN_SKIM:
        matched = _hits(pats, source)
        if matched:
            leads.append({"id": pid, "description": desc, "matched": matched, "kind": "lead"})
    return leads


def detect_weird_signals(source: str) -> list[str]:
    if not source:
        return []
    out: list[str] = []
    for sid, pats in WEIRD_SIGNALS:
        if _hits(pats, source):
            out.append(sid)
    return out


def detect_fork_family(source: str) -> str | None:
    if not source:
        return None
    for name, rx in (
        ("erc4626", r"\bERC4626\b|\bconvertToShares\b"),
        ("yearn", r"\bpricePerShare\b|\bgetPricePerFullShare\b"),
        ("compound", r"\bCErc20\b|\bComptroller\b|\bexchangeRateStored\b"),
        ("aave", r"\bLendingPool\b|\bAToken\b|\bexecuteSupply\b|\bPoolConfigurator\b|\bIPool\b"),
        ("balancer", r"\bjoinPool\b|\bexitPool\b|\bmanageUserBalance\b"),
        ("maker", r"\bmodifier\s+auth\b|\bfunction\s+frob\s*\("),
        ("uniswap-v2", r"\bUniswapV2\b|\bgetReserves\b"),
        ("uniswap-v3", r"\bUniswapV3\b|\buniswapV3SwapCallback\b|\bslot0\b"),
        ("masterchef", r"\bMasterChef\b"),
        ("lido", r"\bgetPooledEthByShares\b|\bgetSharesByPooledEth\b"),
        ("convex", r"\bstakingToken\b|\bnotifyRewardAmount\b|\bearmarkRewards\b"),
        ("morpho", r"\bMarketParams\b|\bfunction\s+supplyCollateral\b"),
        ("eigenlayer", r"\bdepositIntoStrategy\b|\bqueueWithdrawals\b|\bDelegationManager\b"),
        ("pendle", r"\bswapExactPtForSy\b|\baddLiquiditySinglePt\b"),
        ("across", r"\bSpokePool\b|\bfillV3Relay\b|\bdepositV3\b"),
        ("curve", r"\badd_liquidity\b|\bremove_liquidity\b"),
        ("gmx", r"\bbuyUSDG\b|\bguaranteedUsd\b"),
        ("comet", r"\bborrowBalanceOf\b|\bfunction\s+absorb\b"),
    ):
        if re.search(rx, source):
            return name
    return None
