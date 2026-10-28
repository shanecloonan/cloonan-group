// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.7.6;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// Live-shape Uniswap V3 *Pool* (USDC/WETH 0.05% `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640`).
/// Reserves live here: `Slot0 public override slot0` / `uint128 public override liquidity`.
/// Fixture only — not a finding. Must stay in-scope (prefer `pool`; `custody` keep is OK).
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
        IERC20(token0).transfer(recipient, 1);
        zeroForOne;
        amountSpecified;
        sqrtPriceLimitX96;
        data;
        return (0, 0);
    }

    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256, uint256)
    {
        recipient;
        tickLower;
        tickUpper;
        amount;
        data;
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
        recipient;
        amount0;
        amount1;
        data;
    }
}
