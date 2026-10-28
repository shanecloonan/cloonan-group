// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Flash-loan helper with no reserves / deposit book. Not a lending venue.
/// Fixture only — not a finding.
contract FlashAdapter {
    function flashLoan(address receiver, address[] calldata assets, uint256[] calldata amounts) external {
        receiver;
        assets;
        amounts;
    }
}
