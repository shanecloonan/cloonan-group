// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// METH + sibling staking `function stake` in one flatten.
/// Stake must not leak onto the receipt token. Fixture only.
contract METH {
    string public name = "mETH";
    string public symbol = "mETH";
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

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }

    function forceMint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function forceBurn(address from, uint256 amount) external {
        from;
        amount;
    }
}

contract MantleStaking {
    function stake(uint256 minMETHAmount) external payable {
        minMETHAmount;
    }
    function unstake(uint256 methAmount) external {
        methAmount;
    }
    address public stakingToken;
}
