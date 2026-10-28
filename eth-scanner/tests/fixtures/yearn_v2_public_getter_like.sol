// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20YG {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Live Yearn V2 shape: `uint256 public pricePerShare` (getter), not
/// `function pricePerShare()`. Must tag yearn-share-price, not share-accounting.
/// Fixture only — not a finding. yvUSDC-like 0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE.
contract yVault {
    string public name = "yvUSDC";
    string public symbol = "yvUSDC";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20YG public token;
    uint256 public pricePerShare;

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

    function deposit(uint256 amount) external returns (uint256) {
        token.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256 shares) external returns (uint256) {
        balanceOf[msg.sender] -= shares;
        token.transfer(msg.sender, shares);
        return shares;
    }
}
