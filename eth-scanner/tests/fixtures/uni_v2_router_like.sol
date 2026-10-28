// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20R {
    function transferFrom(address, address, uint256) external returns (bool);
}
interface IWETHR {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// Live Uni V2 Router02 (`0x7a25…488D`). addLiquidity is pass-through, not a pool.
/// Fixture only — not a finding.
contract UniswapV2Router02 {
    IWETHR public WETH;

    function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB) external {
        IERC20R(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20R(tokenB).transferFrom(msg.sender, address(this), amountB);
    }

    function addLiquidityETH(address token, uint256 amountToken) external payable {
        IERC20R(token).transferFrom(msg.sender, address(this), amountToken);
        WETH.deposit{value: msg.value}();
    }

    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity) external {
        tokenA;
        tokenB;
        liquidity;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path) external {
        IERC20R(path[0]).transferFrom(msg.sender, address(this), amountIn);
        amountOutMin;
    }

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path) external payable {
        WETH.deposit{value: msg.value}();
        amountOutMin;
        path;
    }

    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path) external {
        IERC20R(path[0]).transferFrom(msg.sender, address(this), amountIn);
        amountOutMin;
    }
}
