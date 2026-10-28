// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Liquity BorrowerOperations (`0x24179CD81c9e782A4096035f7eC97fB8B783e007`).
/// openTrove / addColl / withdrawColl hold trove collateral accounting.
/// Must be lending, not generic custody. Fixture only — not a finding.
contract BorrowerOperations {
    function openTrove(uint256 maxFee, uint256 lusdAmount, address upperHint, address lowerHint) external payable {
        maxFee;
        lusdAmount;
        upperHint;
        lowerHint;
    }

    function addColl(address upperHint, address lowerHint) external payable {
        upperHint;
        lowerHint;
    }

    function withdrawColl(uint256 amount, address upperHint, address lowerHint) external {
        amount;
        upperHint;
        lowerHint;
    }

    function withdrawLUSD(uint256 maxFee, uint256 amount, address upperHint, address lowerHint) external {
        maxFee;
        amount;
        upperHint;
        lowerHint;
    }

    function repayLUSD(uint256 amount, address upperHint, address lowerHint) external {
        amount;
        upperHint;
        lowerHint;
    }

    function adjustTrove(
        uint256 maxFee,
        uint256 collWithdrawal,
        uint256 lusdChange,
        bool isDebtIncrease,
        address upperHint,
        address lowerHint
    ) external payable {
        maxFee;
        collWithdrawal;
        lusdChange;
        isDebtIncrease;
        upperHint;
        lowerHint;
    }

    function closeTrove() external {}
}
