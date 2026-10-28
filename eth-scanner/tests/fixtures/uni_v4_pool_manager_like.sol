// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Uniswap V4 PoolManager (`0x000000000004444c5dc75cB358380D2e3dE08A90`).
/// Singleton reserve custody for every v4 pool. mint/burn/swap already
/// tag amm-pool-movers — pin so settle+swap cannot later cool as CoW.
/// Fixture only — not a finding.
contract PoolManager {
    function unlock(bytes calldata data) external returns (bytes memory) {
        return data;
    }

    function swap(bytes32 poolId, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata hookData) external returns (int256) {
        poolId;
        zeroForOne;
        sqrtPriceLimitX96;
        hookData;
        return amountSpecified;
    }

    function mint(address to, uint256 id, uint256 amount) external {
        to;
        id;
        amount;
    }

    function burn(address from, uint256 id, uint256 amount) external {
        from;
        id;
        amount;
    }

    function take(address currency, address to, uint256 amount) external {
        currency;
        to;
        amount;
    }

    function settle() external payable returns (uint256) {
        return msg.value;
    }

    function sync(address currency) external {
        currency;
    }
}
