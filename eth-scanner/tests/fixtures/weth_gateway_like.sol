// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPoolGw {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256);
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// Spark / Aave WrappedTokenGatewayV3 (`0xBD7D…1704`). Wraps ETH and forwards
/// to the pool — pass-through, not a hold. Fixture only — not a finding.
contract WrappedTokenGatewayV3 {
    address public pool;
    address public weth;

    function getWETHAddress() external view returns (address) {
        return weth;
    }

    function depositETH(address, address onBehalfOf, uint16 referralCode) external payable {
        IPoolGw(pool).supply(weth, msg.value, onBehalfOf, referralCode);
    }

    function withdrawETH(address, uint256 amount, address to) external {
        IPoolGw(pool).withdraw(weth, amount, to);
    }

    function borrowETH(address, uint256 amount, uint256 interestRateMode, uint16 referralCode) external {
        IPoolGw(pool).borrow(weth, amount, interestRateMode, referralCode, msg.sender);
    }

    function repayETH(address, uint256 amount, uint256 rateMode, address onBehalfOf) external payable {
        IPoolGw(pool).repay(weth, amount, rateMode, onBehalfOf);
    }
}
