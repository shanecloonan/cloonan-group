// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Wormhole TokenBridge impl (`0x3817…841e`; proxy `0x3ee1…a585`).
/// Locks tokens here and completes attested transfers.
/// Fixture only — not a finding.
contract BridgeImplementation {
    function attestToken(address token, uint32 nonce) external {
        token;
        nonce;
    }

    function transferTokens(address token, uint256 amount, uint16 dst, bytes32 to) external {
        token;
        amount;
        dst;
        to;
    }

    function wrapAndTransferETH(uint16 dst, bytes32 to) external payable {
        dst;
        to;
    }

    function completeTransfer(bytes memory encoded) external {
        encoded;
    }
}
