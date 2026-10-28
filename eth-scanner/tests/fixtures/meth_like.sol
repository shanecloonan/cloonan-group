// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Mantle mETH impl (`0x052f52748109bae13d6319a463d64b6a2a613e52`).
/// Proxy `0xd5F7…Dfa`. mint / burn / forceMint / forceBurn are token-admin.
/// The staking contract holds ETH — this address is a receipt. Fixture only.
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
        totalSupply += amount;
    }

    function forceBurn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}
