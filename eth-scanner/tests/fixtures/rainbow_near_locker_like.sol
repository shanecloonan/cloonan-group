// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Rainbow NEAR ERC20Locker (`0x23Dd…27f`). Lock-release to NEAR.
/// lockToken (singular) — Polygon predicates use lockTokens.
/// Fixture only — not a finding.
contract ERC20Locker {
    function lockToken(address token, uint256 amount, string calldata recipientAccountId) external {
        token;
        amount;
        recipientAccountId;
    }

    function unlockToken(bytes calldata proofData, uint64 proofBlockHeight) external {
        proofData;
        proofBlockHeight;
    }

    function proveOutcome(bytes calldata proofData, uint64 proofBlockHeight) external view returns (bool) {
        proofData;
        proofBlockHeight;
        return true;
    }

    function decodeBlockHeaderLight(bytes calldata data) external pure returns (bytes memory) {
        return data;
    }
}
