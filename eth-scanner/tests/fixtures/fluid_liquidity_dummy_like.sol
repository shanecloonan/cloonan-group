// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Fluid Liquidity DummyImpl (`0xcc33…6a2`). Etherscan Implementation for
/// proxy `0x52Aa…497`. ABI surface includes operate — money sits on the proxy.
/// Must be lending / fluid-liquidity, not utility. Fixture only.
contract FluidLiquidityDummyImpl {
    function operate(
        address token_,
        int256 supplyAmount_,
        int256 borrowAmount_,
        address withdrawTo_,
        address borrowTo_,
        bytes calldata callbackData_
    ) external payable returns (uint256, uint256) {
        token_;
        supplyAmount_;
        borrowAmount_;
        withdrawTo_;
        borrowTo_;
        callbackData_;
        return (0, 0);
    }

    function operateOnBehalfOf(
        address onBehalf_,
        address token_,
        int256 supplyAmount_,
        int256 borrowAmount_,
        bytes calldata callbackData_
    ) external payable returns (uint256, uint256) {
        onBehalf_;
        token_;
        supplyAmount_;
        borrowAmount_;
        callbackData_;
        return (0, 0);
    }

    function updateUserBorrowConfigs(bytes calldata data) external {
        data;
    }
}
