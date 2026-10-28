// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Swell swETH impl (`0xce95ba824ae9a4df9b303c0bbf4d605ba2affbfc`).
/// Proxy `0xf951…Ed78`. Payable deposit + reprice — LST venue, not a bridge.
/// Fixture only — not a finding.
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

    function depositWithReferral(address referral) external payable {
        referral;
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    function reprice(uint256 newRate) external {
        swETHToETHRate = newRate;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }

    function withdrawERC20(address token, uint256 amount) external {
        token;
        amount;
    }
}
