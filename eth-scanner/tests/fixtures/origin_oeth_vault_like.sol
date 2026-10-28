// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Origin OETHVault impl (`0x0E979edF516f88119fa2843fA3f08A9643F8e575`).
/// rebase + allocate + async queue. Must be vault, not Lido WQ.
/// Fixture only — not a finding.
contract OETHVault {
    function mint(address asset, uint256 amount, uint256 minOeth) external {
        asset;
        amount;
        minOeth;
    }

    function rebase() external {}

    function allocate() external {}

    function requestWithdrawal(uint256 amount) external returns (uint256) {
        return amount;
    }

    function claimWithdrawal(uint256 requestId) external {
        requestId;
    }

    function claimWithdrawals(uint256[] calldata requestIds) external {
        requestIds;
    }

    function addWithdrawalQueueLiquidity() external payable {}
}
