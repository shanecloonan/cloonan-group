// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Liquity V2 BOLD (`0x6440f144b7e50D6a8439336510312d2F54beB01D`).
/// Admin ERC-20 — cool-archive. Fixture only — not a finding.
contract BoldToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "BOLD Stablecoin";
    string public symbol = "BOLD";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
        totalSupply += value;
    }

    function burn(address from, uint256 value) external {
        balanceOf[from] -= value;
        totalSupply -= value;
    }
}
