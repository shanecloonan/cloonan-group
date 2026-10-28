// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal staking book for defensive balance conservation fuzz.
/// A single account's stake cannot exceed totalSupply.
contract MockStaking {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    function stake(uint256 amount) public {
        require(amount > 0, "amount");
        balanceOf[msg.sender] += amount;
        totalSupply += amount;
    }

    function unstake(uint256 amount) public {
        require(amount > 0 && balanceOf[msg.sender] >= amount, "amount");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }
}
