// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sourcify leak: EzEthToken trees can ship sibling RestakeManager.
/// `depositETH` on the manager must not flip the ezETH *token* to staking
/// when ContractName is EzEthToken. Fixture only — not a finding.

contract RestakeManager {
    function deposit(address asset, uint256 amount) external { asset; amount; }
    function depositETH() external payable {}
}

contract EzEthToken {
    string public name = "Renzo Restaked ETH";
    string public symbol = "ezETH";
    mapping(address => uint256) public balanceOf;
    RestakeManager public manager;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        spender;
        value;
        return true;
    }
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function burn(address from, uint256 amount) external { balanceOf[from] -= amount; }
}
