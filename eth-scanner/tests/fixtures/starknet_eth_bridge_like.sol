// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// StarknetEthBridge impl (`0x95ff25a59dc9c5a41cf0709dc916041e5dc7fd95`).
/// Proxy `0xae0E…D419` (StarkGate ETH). deposit / depositWithMessage / withdraw
/// lock-release ETH. Must be *bridge*, not erc20-plus-custody. Fixture only.
contract StarknetEthBridge {
    function deposit(uint256 l2Recipient) external payable {
        l2Recipient;
    }

    function depositWithMessage(uint256 l2Recipient, uint256[] calldata message) external payable {
        l2Recipient;
        message;
    }

    function withdraw(uint256 amount, address recipient) external {
        amount;
        recipient;
    }

    function depositCancelRequest(uint256 l2Recipient, uint256 amount, uint256 nonce) external {
        l2Recipient;
        amount;
        nonce;
    }
}
