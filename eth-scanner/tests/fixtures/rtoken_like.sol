// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Rt {
    function transfer(address, uint256) external returns (bool);
}

/// Reserve eUSD RToken impl (`0x258c…b3C`; proxy `0xA0d6…482F`).
/// issue/redeem/melt are token-admin. Basket sits on BackingManager.
/// Fixture only — not a finding.
contract RTokenP1 {
    string public name = "eUSD";
    string public symbol = "eUSD";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    uint256 public basketsNeeded;
    address public backingManager;

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

    function issue(uint256 amount) public {
        issueTo(msg.sender, amount);
    }
    function issueTo(address recipient, uint256 amount) public {
        balanceOf[recipient] += amount;
        totalSupply += amount;
    }
    function redeem(uint256 amount) external {
        redeemTo(msg.sender, amount);
    }
    function redeemTo(address recipient, uint256 amount) public {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        recipient;
    }
    function redeemCustom(address recipient, uint256 amount) external {
        redeemTo(recipient, amount);
    }
    function melt(uint256 amtRToken) external {
        balanceOf[msg.sender] -= amtRToken;
        totalSupply -= amtRToken;
    }
    function monetizeDonations(address erc20) external {
        IERC20Rt(erc20).transfer(backingManager, 1);
    }
}
