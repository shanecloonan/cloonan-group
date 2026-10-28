// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// USDC-shaped ERC20 with mint/burn/rescue. Still a token — demote. Fixture only.
contract FiatToken {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public masterMinter;

    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value);
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(allowance[from][msg.sender] >= value);
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == masterMinter);
        totalSupply += value;
        balanceOf[to] += value;
    }

    function burn(uint256 value) external {
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
    }

    function rescue(address token, address to, uint256 value) external {
        token; to; value;
    }
}
