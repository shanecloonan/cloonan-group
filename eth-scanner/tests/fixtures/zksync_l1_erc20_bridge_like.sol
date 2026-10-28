// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Z {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// zkSync L1ERC20Bridge impl (`0x6ed98623e0b51be68748ab5091aa891adb883e13`).
/// Proxy `0x5789…e063`. finalizeWithdrawal is the lock-release verb.
/// Must not require the Transaction suffix. Fixture only — not a finding.
contract L1ERC20Bridge {
    function deposit(address l2Receiver, address l1Token, uint256 amount) external payable {
        IERC20Z(l1Token).transferFrom(msg.sender, address(this), amount);
        l2Receiver;
    }

    function finalizeWithdrawal(
        uint256 l2BatchNumber,
        uint256 l2MessageIndex,
        uint16 l2TxNumberInBatch,
        bytes calldata message,
        bytes32[] calldata merkleProof
    ) external {
        l2BatchNumber;
        l2MessageIndex;
        l2TxNumberInBatch;
        message;
        merkleProof;
    }
}
