// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// FraxlendPair (`0x78bB…ef15` sfrxETH/FRAX). Holds collateral + assets.
/// borrowAsset/repayAsset — not Aave borrow/repay. Fixture only — not a finding.
contract FraxlendPair {
    function addCollateral(uint256 amount, address borrower) external {
        amount;
        borrower;
    }

    function removeCollateral(uint256 amount, address receiver) external {
        amount;
        receiver;
    }

    function borrowAsset(uint256 borrowAmount, uint256 collateralAmount, address receiver) external returns (uint256) {
        collateralAmount;
        receiver;
        return borrowAmount;
    }

    function repayAsset(uint256 shares, address borrower) external returns (uint256) {
        borrower;
        return shares;
    }

    function liquidate(address[] memory borrowers) external {
        borrowers;
    }

    function deposit(uint256 amount, address receiver) external returns (uint256) {
        receiver;
        return amount;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        receiver;
        owner;
        return shares;
    }
}
