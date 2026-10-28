// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Liquity TroveManager (`0xA397…bb2`). liquidate / redeemCollateral hold
/// collateral accounting. Must stay *lending*. Fixture only — not a finding.
contract TroveManager {
    function liquidate(address borrower) external {
        borrower;
    }

    function liquidateTroves(uint256 n) external {
        n;
    }

    function redeemCollateral(
        uint256 lusdAmount,
        address firstRedemptionHint,
        address upperPartialRedemptionHint,
        address lowerPartialRedemptionHint,
        uint256 partialRedemptionHintNICR,
        uint256 maxIterations,
        uint256 maxFeePercentage
    ) external {
        lusdAmount;
        firstRedemptionHint;
        upperPartialRedemptionHint;
        lowerPartialRedemptionHint;
        partialRedemptionHintNICR;
        maxIterations;
        maxFeePercentage;
    }
}
