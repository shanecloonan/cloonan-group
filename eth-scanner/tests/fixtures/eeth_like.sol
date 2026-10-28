// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live eETH token (`0x35fA164735182de50811E8e2E824cFb9B6118ac2`).
/// Rebasing share token — LiquidityPool holds ETH. This address is a token.
/// mintShares / burnShares are pool-admin, not a staking venue here.
/// Fixture only — not a finding.
contract EETH {
    string public name = "ether.fi ETH";
    string public symbol = "eETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    address public liquidityPool;

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

    function mintShares(address to, uint256 shares) external {
        require(msg.sender == liquidityPool);
        balanceOf[to] += shares;
        totalSupply += shares;
    }

    function burnShares(address from, uint256 shares) external {
        require(msg.sender == liquidityPool);
        balanceOf[from] -= shares;
        totalSupply -= shares;
    }
}
