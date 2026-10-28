// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Rocket Pool rETH (`0xae78736Cd615f374D3085123A210448E74Fc6393`).
/// Token holds excess ETH (depositExcess / burn). getEthValue / getRethValue
/// are the share rates — this is the venue, not a wrap-token. Fixture only.
contract RocketTokenRETH {
    string public name = "Rocket Pool ETH";
    string public symbol = "rETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }
    function transferFrom(address, address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }

    function getEthValue(uint256 rethAmount) public view returns (uint256) {
        return rethAmount;
    }
    function getRethValue(uint256 ethAmount) public view returns (uint256) {
        return ethAmount;
    }

    function depositExcess() external payable {
        totalSupply += msg.value;
    }

    function depositExcessCollateral() external payable {
        totalSupply += msg.value;
    }

    function mint(uint256 amount, address to) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(uint256 rethAmount) external {
        balanceOf[msg.sender] -= rethAmount;
        totalSupply -= rethAmount;
    }
}
