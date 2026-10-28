// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Spark {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// SparkLend Pool impl (`0x5aE3…0e1b`). Proxy `0xC13e…E987`.
/// Aave-v3-shaped lending venue. Fixture only — not a finding.
contract Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) public virtual {
        IERC20Spark(asset).transferFrom(msg.sender, address(this), amount);
        onBehalfOf; referralCode;
    }

    function withdraw(address asset, uint256 amount, address to) public virtual returns (uint256) {
        IERC20Spark(asset).transfer(to, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) public virtual {
        IERC20Spark(asset).transfer(onBehalfOf, amount);
        interestRateMode; referralCode;
    }

    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) public virtual returns (uint256) {
        IERC20Spark(asset).transferFrom(msg.sender, address(this), amount);
        rateMode; onBehalfOf;
        return amount;
    }

    function liquidationCall(address collateral, address debt, address user, uint256 debtToCover, bool receiveAToken) public virtual {
        collateral; debt; user; debtToCover; receiveAToken;
    }
}
