// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// TermRepoCollateralManager impl (`0xb99F…Df53`). Encumbered collateral sits here.
/// Fixture only — not a finding.
contract TermRepoCollateralManager {
    function externalLockCollateral(address borrower, address token, uint256 amount) external {
        borrower;
        token;
        amount;
    }

    function externalUnlockCollateral(address borrower, address token, uint256 amount) external {
        borrower;
        token;
        amount;
    }

    function auctionLockCollateral(address bidder, address token, uint256 amount) external {
        bidder;
        token;
        amount;
    }

    function unlockCollateralOnRepurchase(address borrower) external {
        borrower;
    }

    function getCollateralBalance(address borrower, address token) external view returns (uint256) {
        borrower;
        token;
        return 0;
    }
}
