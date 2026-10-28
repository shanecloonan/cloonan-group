// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live OptimismPortal2 implementation (`0x1005217ad392dc64cef501fa1777a27d42166748`).
/// Proxy `0xbEb5…06Ed` is a Proxy-only blob; IR must lift this impl.
/// Etherscan 2026-10-28: ContractName=`OptimismPortal2`, Sourcify 200.
/// Fixture only — not a finding. Not the full 239k verified blob.
contract OptimismPortal2 {
    function depositTransaction(address to, uint256 value, uint64 gasLimit, bool isCreation, bytes memory data) external payable {
        to;
        value;
        gasLimit;
        isCreation;
        data;
    }

    function proveWithdrawalTransaction(address txTarget, uint256 disputeGameIndex, bytes32 outputRootProof, bytes[] calldata withdrawalProof) external {
        txTarget;
        disputeGameIndex;
        outputRootProof;
        withdrawalProof;
    }

    function finalizeWithdrawalTransaction(address txTarget) external {
        txTarget;
    }

    function finalizeWithdrawalTransactionExternalProof(address txTarget, address proofSubmitter) external {
        txTarget;
        proofSubmitter;
    }
}
