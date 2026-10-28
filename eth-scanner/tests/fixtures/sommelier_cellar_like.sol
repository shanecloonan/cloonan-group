// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sommelier Cellar impl (`0x99bA…bfe6`). 4626 vault; callOnAdaptor rebalances.
/// Sibling swap adaptors must not steal as router. Fixture only — not a finding.
contract CellarInitializableV2_1 {
    address public holdingPosition;

    function addPosition(uint256 index, address position, bytes memory config, bool inDebt) external {
        index;
        position;
        config;
        inDebt;
    }

    function callOnAdaptor(bytes[] memory data) external {
        data;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        receiver;
        return assets;
    }

    function mint(uint256 shares, address receiver) external returns (uint256) {
        receiver;
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        receiver;
        owner;
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        receiver;
        owner;
        return shares;
    }

    function convertToShares(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function totalAssets() external pure returns (uint256) {
        return 0;
    }
}

/// Same-tree swap adaptor. Unique-router verbs must not steal the cellar.
contract SwapWithUniswapAdaptor {
    function swapWithUniV3(address tokenIn, address tokenOut, uint24 fee, uint256 amount) external {
        tokenIn;
        tokenOut;
        fee;
        amount;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to) external {
        amountIn;
        amountOutMin;
        path;
        to;
    }
}
