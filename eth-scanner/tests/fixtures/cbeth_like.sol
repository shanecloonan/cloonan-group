// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20C {
    function transfer(address to, uint256 value) external returns (bool);
}

/// Live Coinbase cbETH (`0xBe9895146f7AF43049ca1c1AE358B0541Ea49704`).
/// Impl `StakedTokenV1` — FiatToken mint/burn/rescueERC20 + oracle exchangeRate.
/// Coinbase holds staked ETH off-chain. Share-wrap, not a vault.
/// Fixture only — not a finding.
contract StakedTokenV1 {
    string public name = "Coinbase Wrapped Staked ETH";
    string public symbol = "cbETH";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public masterMinter;
    address public owner;
    uint256 private _exchangeRate;

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

    function mint(address to, uint256 value) external {
        require(msg.sender == masterMinter);
        totalSupply += value;
        balanceOf[to] += value;
    }
    function burn(uint256 value) external {
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
    }
    function rescueERC20(address token, address to, uint256 value) external {
        IERC20C(token).transfer(to, value);
    }
    function updateOracle(address newOracle) external { newOracle; }
    function updateExchangeRate(uint256 newExchangeRate) external { _exchangeRate = newExchangeRate; }
    function oracle() public view returns (address) { return owner; }
    function exchangeRate() public view returns (uint256) { return _exchangeRate; }
}
