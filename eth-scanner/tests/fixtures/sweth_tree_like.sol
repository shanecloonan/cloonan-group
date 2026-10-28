// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Same-file sibling: swETH + a withdrawal-NFT iface with finalizeWithdrawal.
/// Live flatten used to win as *bridge* via full-src regex. Fixture only.
interface IswETHWithdrawals {
    function finalizeWithdrawal(uint256 tokenId) external;
}

contract swETH {
    string public name = "swETH";
    string public symbol = "swETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    uint256 public swETHToETHRate;

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
        swETHToETHRate = newRate;
    }

    function burn(uint256 amount) external {
        amount;
    }
}
