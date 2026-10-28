// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Frax frxETH (`0x5E8422345238F34275888049021821E8E08Caa1f`).
/// Permissioned minter_mint / minter_burn_from on an ERC-20 receipt.
/// ETH sits in the redemption / staking venue, not here. Must cool as
/// token. Fixture only — not a finding.
contract frxETH {
    string public name = "Frax Ether";
    string public symbol = "frxETH";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function minter_mint(address to, uint256 amt) external {
        totalSupply += amt;
        balanceOf[to] += amt;
    }

    function minter_burn_from(address from, uint256 amt) external {
        totalSupply -= amt;
        balanceOf[from] -= amt;
    }
}
