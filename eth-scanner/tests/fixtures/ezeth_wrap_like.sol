// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEzETHW {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// weETH-class wrap of ezETH. Must demote wrap-token. Fixture only.
contract WezETH {
    string public name = "Wrapped ezETH";
    string public symbol = "wezETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IEzETHW public ezETH;

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

    function wrap(uint256 ezETHAmount) public returns (uint256) {
        ezETH.transferFrom(msg.sender, address(this), ezETHAmount);
        uint256 shares = getEzETHByETH(ezETHAmount);
        balanceOf[msg.sender] += shares;
        return shares;
    }
    function unwrap(uint256 wezETHAmount) external returns (uint256) {
        balanceOf[msg.sender] -= wezETHAmount;
        uint256 out = getETHByEzETH(wezETHAmount);
        ezETH.transfer(msg.sender, out);
        return out;
    }
    function getEzETHByETH(uint256 ethAmount) public view returns (uint256) { return ethAmount; }
    function getETHByEzETH(uint256 ezETHAmount) public view returns (uint256) { return ezETHAmount; }
}
