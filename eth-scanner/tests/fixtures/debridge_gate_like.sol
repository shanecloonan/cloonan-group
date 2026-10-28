// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// DeBridgeGate impl (`0x7971…658e`; proxy `0x43dE…98aA`).
/// Lock + claim. getDebridgeId is unique — send+claim is not.
/// Fixture only — not a finding.
contract DeBridgeGate {
    function send(address token, uint256 amount, uint256 chainIdTo, bytes calldata receiver) external payable {
        token;
        amount;
        chainIdTo;
        receiver;
    }

    function claim(bytes32 debridgeId, uint256 amount, uint256 chainIdFrom, address receiver) external {
        debridgeId;
        amount;
        chainIdFrom;
        receiver;
    }

    function getDebridgeId(uint256 chainId, address tokenAddress) external pure returns (bytes32) {
        chainId;
        tokenAddress;
        return bytes32(0);
    }

    function withdrawFee(bytes32 debridgeId) external {
        debridgeId;
    }
}
