// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Scroll L1ScrollMessenger impl (`0x79b6eabffaa958fdf2aa2bf632878bd323dcbf69`).
/// Proxy `0x6774…b367`. ETH for L2 deposits sits here.
/// relayMessageWithProof / replayMessage — not generic custody. Fixture only.
contract L1ScrollMessenger {
    function sendMessage(address to, uint256 value, bytes calldata message, uint256 gasLimit) external payable {
        to;
        value;
        message;
        gasLimit;
    }

    function relayMessageWithProof(
        address from,
        address to,
        uint256 value,
        uint256 nonce,
        bytes calldata message,
        bytes calldata proof
    ) external {
        from;
        to;
        value;
        nonce;
        message;
        proof;
    }

    function replayMessage(
        address from,
        address to,
        uint256 value,
        uint256 nonce,
        bytes calldata message,
        uint32 newGasLimit
    ) external {
        from;
        to;
        value;
        nonce;
        message;
        newGasLimit;
    }
}
