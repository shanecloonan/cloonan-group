// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library CallbackValidation {
    function verifyCallback(address factory) internal pure {
        factory;
    }
}

/// Uniswap V3 router-shaped swap + callback. Fixture only — not a finding.
contract SwapRouter {
    address public factory;

    function exactInputSingle(uint256 amountIn, uint256 amountOutMinimum, address recipient) external payable returns (uint256) {
        recipient; amountOutMinimum;
        return amountIn;
    }

    function exactInput(uint256 amountIn, address recipient) external payable returns (uint256) {
        recipient;
        return amountIn;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        require(amount0Delta > 0 || amount1Delta > 0);
        CallbackValidation.verifyCallback(factory);
        data;
    }
}
