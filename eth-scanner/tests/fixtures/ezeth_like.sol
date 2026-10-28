// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Renzo ezETH token (`0xbf5495Efe5DB9ce00f80364C8B423567e58d2110`).
/// Impl `EzEthToken` at `0x9bD2…CDA2C` — mint/burn only.
/// RestakeManager holds deposits. This address is a share token.
/// Fixture only — not a finding.
contract EzEthToken {
    string public name = "Renzo Restaked ETH";
    string public symbol = "ezETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public paused;

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

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function burn(address from, uint256 amount) external { balanceOf[from] -= amount; }
    function setPaused(bool next) external { paused = next; }
}
