// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Origin wOETH-shaped wrap of rebasing OETH (weETH-class).
/// wrap/unwrap + named rate converters. Live wOETH source was empty here.
/// Fixture only — not a finding.
contract WOETH {
    string public name = "Wrapped OETH";
    string public symbol = "wOETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

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

    function wrap(uint256 oethAmount) external returns (uint256) {
        balanceOf[msg.sender] += oethAmount;
        totalSupply += oethAmount;
        return oethAmount;
    }

    function unwrap(uint256 woethAmount) external returns (uint256) {
        balanceOf[msg.sender] -= woethAmount;
        totalSupply -= woethAmount;
        return woethAmount;
    }

    function getWOETHByOETH(uint256 oethAmount) external view returns (uint256) {
        return oethAmount;
    }

    function getOETHByWOETH(uint256 woethAmount) external view returns (uint256) {
        return woethAmount;
    }
}
