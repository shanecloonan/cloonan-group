// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Gated withdraw — onlyOwner. Heuristic lead fixture, not a finding.
contract GatedVault {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function withdraw(uint256 amt) external onlyOwner {
        payable(owner).transfer(amt);
    }
}
