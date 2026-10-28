// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// zkSync Era MailboxFacet (`0x1e34ab39a9682149165ddecc0583d238a5448b45`).
/// Diamond proxy `0x3240…0324`. requestL2Transaction locks ETH;
/// finalizeEthWithdrawal releases it. Fixture only — not a finding.
contract MailboxFacet {
    function requestL2Transaction(
        address contractL2,
        uint256 l2Value,
        bytes calldata calldata_,
        uint256 l2GasLimit,
        uint256 l2GasPerPubdataByteLimit,
        bytes[] calldata factoryDeps,
        address refundRecipient
    ) external payable {
        contractL2;
        l2Value;
        calldata_;
        l2GasLimit;
        l2GasPerPubdataByteLimit;
        factoryDeps;
        refundRecipient;
    }

    function finalizeEthWithdrawal(
        uint256 chainId,
        uint256 l2BatchNumber,
        uint256 l2MessageIndex,
        uint16 l2TxNumberInBatch,
        bytes calldata message,
        bytes32[] calldata merkleProof
    ) external {
        chainId;
        l2BatchNumber;
        l2MessageIndex;
        l2TxNumberInBatch;
        message;
        merkleProof;
    }
}
