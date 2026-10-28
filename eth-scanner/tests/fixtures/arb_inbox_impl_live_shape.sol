// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Arbitrum Inbox implementation (`0x7c058ad1d0ee415f7e7f30e62db1bcf568470a10`).
/// Proxy `0x4Dbd…AB3f` is TransparentUpgradeableProxy-only. ContractName=`Inbox`.
/// Etherscan 2026-10-28 + Sourcify exact_match. Fixture only — not a finding.
contract Inbox {
    function depositEth() external payable returns (uint256) {
        return msg.value;
    }

    function createRetryableTicket(
        address to,
        uint256 l2CallValue,
        uint256 maxSubmissionCost,
        address excessFeeRefundAddress,
        address callValueRefundAddress,
        uint256 gasLimit,
        uint256 maxFeePerGas,
        bytes calldata data
    ) external payable returns (uint256) {
        to;
        l2CallValue;
        maxSubmissionCost;
        excessFeeRefundAddress;
        callValueRefundAddress;
        gasLimit;
        maxFeePerGas;
        data;
        return 1;
    }

    function unsafeCreateRetryableTicket(
        address to,
        uint256 l2CallValue,
        uint256 maxSubmissionCost,
        address excessFeeRefundAddress,
        address callValueRefundAddress,
        uint256 gasLimit,
        uint256 maxFeePerGas,
        bytes calldata data
    ) external payable returns (uint256) {
        to;
        l2CallValue;
        maxSubmissionCost;
        excessFeeRefundAddress;
        callValueRefundAddress;
        gasLimit;
        maxFeePerGas;
        data;
        return 2;
    }
}
