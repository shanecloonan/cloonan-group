// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Usd0 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Usual USD0++ impl (`0x9F2B…C85B`; proxy `0x35D8…9bC0`).
/// Four-year USD0 bond. Holds USD0 until unwrap. Honest custody keep —
/// do not invent a weak Usual family. Fixture only — not a finding.
contract Usd0PP {
    string public name = "USD0++";
    string public symbol = "USD0++";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20Usd0 public usd0;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        from;
        return true;
    }

    function mint(uint256 amountUsd0) external {
        usd0.transferFrom(msg.sender, address(this), amountUsd0);
        balanceOf[msg.sender] += amountUsd0;
    }

    function unwrap() external {
        uint256 bal = balanceOf[msg.sender];
        balanceOf[msg.sender] = 0;
        usd0.transfer(msg.sender, bal);
    }

    function unwrapWithCap(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        usd0.transfer(msg.sender, amount);
    }

    function unlockUsd0ppFloorPrice(uint256 usd0ppAmount) external {
        balanceOf[msg.sender] -= usd0ppAmount;
        usd0.transfer(msg.sender, usd0ppAmount);
    }

    function emergencyWithdraw(address safeAccount) external {
        usd0.transfer(safeAccount, 1);
    }
}
