// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Arbitrum Nitro ETH Bridge impl (`0xfE47…2418`; proxy `0x8315…ed3a`).
/// ETH escrow for delayed/sequencer messages. Same family as Robinhood
/// Chain Bridge (`0xDf87…64b3`). enqueueDelayedMessage +
/// acceptFundsFromOldBridge — not Inbox createRetryableTicket.
/// Fixture only — not a finding.
contract Bridge {
    address public sequencerInbox;
    address public activeOutbox;

    function enqueueDelayedMessage(
        uint8 kind,
        address sender,
        bytes32 messageDataHash
    ) external payable returns (uint256) {
        kind;
        sender;
        messageDataHash;
        return 0;
    }

    function enqueueSequencerMessage(
        bytes32 dataHash,
        uint256 afterDelayedMessagesRead,
        uint256 prevMessageCount,
        uint256 newMessageCount
    ) external returns (uint256, bytes32, bytes32, bytes32) {
        dataHash;
        afterDelayedMessagesRead;
        prevMessageCount;
        newMessageCount;
        return (0, bytes32(0), bytes32(0), bytes32(0));
    }

    function acceptFundsFromOldBridge() external payable {}
}
