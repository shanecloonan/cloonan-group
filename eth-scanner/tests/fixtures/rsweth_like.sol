// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Swell rswETH impl (`0x4796…362`). Proxy `0xFAe1…4B4`.
/// Payable deposit + reprice — swell LST venue, not EigenLayer.
/// Fixture only — not a finding.
contract RswETH {
    string public name = "rswETH";
    string public symbol = "rswETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    uint256 public rswETHToETHRate;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }
    function transferFrom(address, address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    function reprice(uint256 newRate) external {
        rswETHToETHRate = newRate;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }
}
