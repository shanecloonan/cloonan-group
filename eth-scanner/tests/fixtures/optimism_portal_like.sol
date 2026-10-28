// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Optimism Portal 2 (`0xbEb5Fc579115071764c7423A4f12eDde41f106Ed`).
/// Impl `OptimismPortal2`. Locks ETH for L2 deposits; proves/finalizes withdrawals.
/// `finalizeWithdrawalTransaction` must match — word-bounded `finalizeWithdrawal` does not.
/// Fixture only — not a finding.
contract OptimismPortal2 {
    mapping(bytes32 => bool) public finalizedWithdrawals;
    address public l2Sender;

    function depositTransaction(
        address to,
        uint256 value,
        uint64 gasLimit,
        bool isCreation,
        bytes memory data
    ) external payable {
        to;
        value;
        gasLimit;
        isCreation;
        data;
    }

    function proveWithdrawalTransaction(
        address txTarget,
        uint256 disputeGameIndex,
        bytes32 outputRootProof,
        bytes[] calldata withdrawalProof
    ) external {
        txTarget;
        disputeGameIndex;
        outputRootProof;
        withdrawalProof;
    }

    function finalizeWithdrawalTransaction(address txTarget) external {
        finalizedWithdrawals[bytes32(uint256(uint160(txTarget)))] = true;
        l2Sender = txTarget;
    }

    function finalizeWithdrawalTransactionExternalProof(address txTarget, address proofSubmitter) external {
        txTarget;
        proofSubmitter;
    }
}
