// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Router that embeds a pool interface (`slot0`). Must stay pass-through, not pool.
/// Fixture only — not a finding.
interface IUniswapV3PoolLike {
    function slot0() external view returns (uint160, int24);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified) external;
}

contract SwapRouterWithIface {
    address public factory;

    function exactInputSingle(uint256 amountIn, address recipient) external payable returns (uint256) {
        recipient;
        return amountIn;
    }

    function exactInput(uint256 amountIn, address recipient) external payable returns (uint256) {
        recipient;
        return amountIn;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        amount0Delta;
        amount1Delta;
        data;
    }
}
