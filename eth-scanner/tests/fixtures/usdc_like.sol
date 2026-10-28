// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Admin {
    function transfer(address to, uint256 value) external returns (bool);
}

/// USDC-shaped ERC20 with mint/burn/rescueERC20 (live FiatToken name). Still a token — demote. Fixture only.
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

    function rescueERC20(address token, address to, uint256 value) external {
        // Live Circle FiatTokenV2_1 body: IERC20(token).transfer(to, amount).
        IERC20Admin(token).transfer(to, value);
    }
}
