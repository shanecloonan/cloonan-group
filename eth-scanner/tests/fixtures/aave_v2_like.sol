// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20V2 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Aave V2-shaped lending pool. Fixture only — not a finding.
contract LendingPool {
    function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        IERC20V2(asset).transferFrom(msg.sender, address(this), amount);
        onBehalfOf; referralCode;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        IERC20V2(asset).transfer(to, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external {
        IERC20V2(asset).transfer(onBehalfOf, amount);
        interestRateMode; referralCode;
    }

    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256) {
        IERC20V2(asset).transferFrom(msg.sender, address(this), amount);
        rateMode; onBehalfOf;
        return amount;
    }

    function flashLoan(address receiver, address[] calldata assets, uint256[] calldata amounts) external {
        receiver; assets; amounts;
    }
}
