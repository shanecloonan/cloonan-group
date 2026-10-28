// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStETHWrap {
    function getPooledEthByShares(uint256 shares) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Live wstETH shape (`0x7f39…Ca0`). Wrap of stETH — demote wrap-token.
/// Calls stETH.getPooledEthByShares; this contract does not implement it.
/// Fixture only — not a finding.
contract WstETH {
    string public name = "Wrapped liquid staked Ether 2.0";
    string public symbol = "wstETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IStETHWrap public stETH;

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

    function wrap(uint256 stETHAmount) external returns (uint256) {
        stETH.transferFrom(msg.sender, address(this), stETHAmount);
        uint256 shares = getWstETHByStETH(stETHAmount);
        balanceOf[msg.sender] += shares;
        return shares;
    }

    function unwrap(uint256 wstETHAmount) external returns (uint256) {
        balanceOf[msg.sender] -= wstETHAmount;
        uint256 st = getStETHByWstETH(wstETHAmount);
        stETH.transfer(msg.sender, st);
        return st;
    }

    function getWstETHByStETH(uint256 stETHAmount) public view returns (uint256) {
        return stETHAmount;
    }
    function getStETHByWstETH(uint256 wstETHAmount) public view returns (uint256) {
        return stETH.getPooledEthByShares(wstETHAmount);
    }
    function stEthPerToken() public view returns (uint256) { return 1e18; }
    function tokensPerStEth() public view returns (uint256) { return 1e18; }
}
