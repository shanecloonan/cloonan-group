// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Balancer Vault-shaped join/exit/swap/flashLoan. Fixture only — not a finding.
contract Vault {
    function joinPool(bytes32 poolId, address sender, address recipient) external payable {
        poolId; sender; recipient;
    }

    function exitPool(bytes32 poolId, address sender, address recipient) external {
        poolId; sender; recipient;
    }

    function swap(bytes32 poolId, address tokenIn, address tokenOut, uint256 amount) external returns (uint256) {
        poolId; tokenIn; tokenOut;
        return amount;
    }

    function flashLoan(address recipient, address[] memory tokens, uint256[] memory amounts) external {
        recipient; tokens; amounts;
    }
}
