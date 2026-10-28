// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICbETHW {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// weETH-class wrap helper of cbETH (if one appears). Must demote wrap-token.
/// Fixture only — not a finding.
contract WcbETH {
    string public name = "Wrapped cbETH";
    string public symbol = "wcbETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    ICbETHW public cbETH;

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

    function wrap(uint256 cbETHAmount) public returns (uint256) {
        cbETH.transferFrom(msg.sender, address(this), cbETHAmount);
        uint256 shares = getCbETHByETH(cbETHAmount);
        balanceOf[msg.sender] += shares;
        return shares;
    }
    function unwrap(uint256 wcbETHAmount) external returns (uint256) {
        balanceOf[msg.sender] -= wcbETHAmount;
        uint256 out = getETHByCbETH(wcbETHAmount);
        cbETH.transfer(msg.sender, out);
        return out;
    }
    function getCbETHByETH(uint256 ethAmount) public view returns (uint256) { return ethAmount; }
    function getETHByCbETH(uint256 cbETHAmount) public view returns (uint256) { return cbETHAmount; }
}
