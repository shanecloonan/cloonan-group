// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Liquity V2 TroveManager (`0x7bcb64b2c9206a5b699ed43363f6f98d4776cf5a` WETH).
/// batchLiquidateTroves + redeem / onOpenTrove. Must be lending, not generic
/// custody. V1 uses liquidate. Fixture only — not a finding.
contract TroveManager {
    function batchLiquidateTroves(uint256[] memory troveArray) external {
        troveArray;
    }

    function redeemCollateral(uint256 boldAmount, uint256 maxIterations, uint256 maxFeePercentage) external {
        boldAmount;
        maxIterations;
        maxFeePercentage;
    }

    function urgentRedemption(uint256 boldAmount, uint256[] calldata troveIds, uint256 minCollateral) external {
        boldAmount;
        troveIds;
        minCollateral;
    }

    function onOpenTrove(address owner, uint256 troveId, uint256 annualInterestRate) external {
        owner;
        troveId;
        annualInterestRate;
    }

    function onAdjustTrove(uint256 troveId, uint256 newColl, uint256 newDebt) external {
        troveId;
        newColl;
        newDebt;
    }
}
