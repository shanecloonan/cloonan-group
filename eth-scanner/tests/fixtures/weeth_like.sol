// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IeETHW {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Live weETH (`0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee`) wrap of eETH.
/// Same family as wstETH — demote wrap-token. Fixture only — not a finding.
contract WeETH {
    string public name = "Wrapped eETH";
    string public symbol = "weETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IeETHW public eETH;

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

    function wrap(uint256 eETHAmount) public returns (uint256) {
        eETH.transferFrom(msg.sender, address(this), eETHAmount);
        uint256 shares = getWeETHByeETH(eETHAmount);
        balanceOf[msg.sender] += shares;
        return shares;
    }

    function unwrap(uint256 weETHAmount) external returns (uint256) {
        balanceOf[msg.sender] -= weETHAmount;
        uint256 out = getEETHByWeETH(weETHAmount);
        eETH.transfer(msg.sender, out);
        return out;
    }

    function getWeETHByeETH(uint256 eETHAmount) public view returns (uint256) {
        return eETHAmount;
    }
    function getEETHByWeETH(uint256 weETHAmount) public view returns (uint256) {
        return weETHAmount;
    }
    function getRate() external view returns (uint256) { return 1e18; }
}
