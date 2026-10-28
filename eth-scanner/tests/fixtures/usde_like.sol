// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Ethena USDe (`0x4c9EDD5852cd905f086C759E8383e09bff1E68B3`).
/// Admin ERC-20 receipt — cool-archive. Fixture only — not a finding.
contract USDe {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "USDe";
    string public symbol = "USDe";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public minter;

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
