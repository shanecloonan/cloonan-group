// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Arbitrum Inbox (`0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f`).
/// Impl `Inbox` — `depositEth` + `createRetryableTicket` lock ETH for L2.
/// Fixture only — not a finding.
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
