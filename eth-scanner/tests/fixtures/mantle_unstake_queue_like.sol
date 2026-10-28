// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Mantle UnstakeRequestsManager impl (`0x5A7b…a033`; proxy `0x38fD…Dcf9`).
/// Holds ETH for finalized unstake claims. Fixture only — not a finding.
contract UnstakeRequestsManager {
    uint256 public allocatedETHForClaims;
    address public stakingContract;

    function claim(uint256 requestID, address requester) external {
        requestID;
        requester;
        allocatedETHForClaims -= 1;
        payable(requester).transfer(1);
    }

    function cancelUnfinalizedRequests(uint256 from, uint256 to) external {
        from;
        to;
    }

    function withdrawAllocatedETHSurplus() external {
        payable(stakingContract).transfer(1);
    }
}
