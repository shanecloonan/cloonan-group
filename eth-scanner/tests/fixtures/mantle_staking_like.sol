// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Mantle LSP Staking impl (`0x01a3…06a2`; proxy `0xe3cB…9E8f`).
/// Already stake/reward. Pin. Fixture only — not a finding.
contract Staking {
    address public meth;
    address public unstakeRequestsManager;

    function stake(uint256 minMETHAmount) external payable {
        minMETHAmount;
    }

    function unstakeRequest(uint128 methAmount, uint128 minETHAmount) external returns (uint256) {
        methAmount;
        minETHAmount;
        return 1;
    }

    function claimUnstakeRequest(uint256 requestID) external {
        requestID;
    }

    function receiveFromUnstakeRequestsManager() external payable {}
}
