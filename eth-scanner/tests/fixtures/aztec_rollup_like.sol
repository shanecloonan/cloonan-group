// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Aztec RollupProcessorV3 impl (`0x7d65…2728`; proxy `0xFF1F…0455`).
/// L1 lock for the rollup. depositPendingFunds + processRollup.
/// Fixture only — not a finding.
contract RollupProcessorV3 {
    function depositPendingFunds(uint256 assetId, uint256 amount, address owner, bytes32 proofHash) external payable {
        assetId;
        amount;
        owner;
        proofHash;
    }

    function processRollup(bytes calldata encodedProofData, bytes calldata signatures) external {
        encodedProofData;
        signatures;
    }

    function withdraw(uint256 assetId, address recipient, uint256 amount) external {
        assetId;
        recipient;
        amount;
    }
}
