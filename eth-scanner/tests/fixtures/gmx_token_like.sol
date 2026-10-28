// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// ETH GMX token (0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a) is an ERC-20.
/// GLP vault (buyUSDG / poolAmounts) is Arbitrum-first — do not treat this
/// token as a vault even if an IVault iface is in the verified blob.
/// Fixture only — not a finding.

interface IVault {
    function buyUSDG(address token, address receiver) external returns (uint256);
    function sellUSDG(address token, address receiver) external returns (uint256);
    function increasePosition(address account, address collateralToken, uint256 amount) external;
    function guaranteedUsd(address token) external view returns (uint256);
}

contract GMX {
    string public name = "GMX";
    string public symbol = "GMX";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IVault public vault;

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

    function totalSupply() public view returns (uint256) { return 1; }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }
}
