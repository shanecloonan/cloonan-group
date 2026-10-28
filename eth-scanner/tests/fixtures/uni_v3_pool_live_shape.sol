// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.7.6;

/// Live-shape Uniswap V3 *Pool* (USDC/WETH 0.05% `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640`).
/// Etherscan multi-file blob includes IERC20Minimal + IUniswapV3SwapCallback.
/// The pool *calls* the callback; it does not implement a SwapRouter.
/// Reserves live here: `Slot0 public override slot0` / `uint128 public override liquidity`.
/// Fixture only — not a finding. Must stay in-scope (prefer `pool`; `custody` keep is OK).

interface IERC20Minimal {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IUniswapV3MintCallback {
    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata data) external;
}

interface IUniswapV3FlashCallback {
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external;
}

interface IUniswapV3Pool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked);
    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data) external returns (int256 amount0, int256 amount1);
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256 amount0, uint256 amount1);
    function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) external returns (uint128 amount0, uint128 amount1);
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

contract UniswapV3Pool {
    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint16 observationIndex;
        uint16 observationCardinality;
        uint16 observationCardinalityNext;
        uint8 feeProtocol;
        bool unlocked;
    }

    Slot0 public override slot0;
    uint128 public override liquidity;
    address public immutable override token0;
    address public immutable override token1;

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        IERC20Minimal(token0).transfer(recipient, 1);
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(1, 0, data);
        zeroForOne;
        amountSpecified;
        sqrtPriceLimitX96;
        return (0, 0);
    }

    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256, uint256)
    {
        IUniswapV3MintCallback(msg.sender).uniswapV3MintCallback(1, 1, data);
        recipient;
        tickLower;
        tickUpper;
        amount;
        return (0, 0);
    }

    function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256, uint256) {
        tickLower;
        tickUpper;
        amount;
        return (0, 0);
    }

    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128, uint128) {
        recipient;
        tickLower;
        tickUpper;
        amount0Requested;
        amount1Requested;
        return (0, 0);
    }

    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external {
        IUniswapV3FlashCallback(msg.sender).uniswapV3FlashCallback(0, 0, data);
        recipient;
        amount0;
        amount1;
    }

    function collectProtocol(address recipient, uint128 amount0Requested, uint128 amount1Requested)
        external
        returns (uint128, uint128)
    {
        recipient;
        amount0Requested;
        amount1Requested;
        return (0, 0);
    }
}
