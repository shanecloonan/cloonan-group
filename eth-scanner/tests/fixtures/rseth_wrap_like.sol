// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRsETHW {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// weETH-class wrap of rsETH. wrap/unwrap are custody movers (not WETH-shaped).
/// Must demote wrap-token — same false-keep as live weETH. Fixture only.
contract WrsETH {
    string public name = "Wrapped rsETH";
    string public symbol = "wrsETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IRsETHW public rsETH;

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

    function wrap(uint256 rsETHAmount) public returns (uint256) {
        rsETH.transferFrom(msg.sender, address(this), rsETHAmount);
        uint256 shares = getWrsETHByRsETH(rsETHAmount);
        balanceOf[msg.sender] += shares;
        return shares;
    }
    function unwrap(uint256 wrsETHAmount) external returns (uint256) {
        balanceOf[msg.sender] -= wrsETHAmount;
        uint256 out = getRsETHByWrsETH(wrsETHAmount);
        rsETH.transfer(msg.sender, out);
        return out;
    }
    function getRsETHByETH(uint256 ethAmount) public view returns (uint256) { return ethAmount; }
    function getETHByRsETH(uint256 rsETHAmount) public view returns (uint256) { return rsETHAmount; }
    function getWrsETHByRsETH(uint256 rsETHAmount) public view returns (uint256) { return rsETHAmount; }
    function getRsETHByWrsETH(uint256 wrsETHAmount) public view returns (uint256) { return wrsETHAmount; }
}
