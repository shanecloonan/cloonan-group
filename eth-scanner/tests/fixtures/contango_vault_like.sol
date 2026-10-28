// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Contango Vault impl (`0x3cab…861a`; proxy `0x3F37…F36b`).
/// Holds per-account token balances. depositNative + withdrawNative +
/// depositTo — Fluid uses operate. Fixture only — not a finding.
contract Vault {
    mapping(address => uint256) public totalBalanceOf;

    function deposit(address token, address account, uint256 amount) external returns (uint256) {
        token;
        account;
        totalBalanceOf[token] += amount;
        return amount;
    }

    function depositTo(address token, address account, uint256 amount) external returns (uint256) {
        token;
        account;
        totalBalanceOf[token] += amount;
        return amount;
    }

    function depositNative(address account) external payable returns (uint256) {
        account;
        return msg.value;
    }

    function withdraw(address token, address account, uint256 amount, address to) external returns (uint256) {
        token;
        account;
        to;
        totalBalanceOf[token] -= amount;
        return amount;
    }

    function withdrawNative(address account, uint256 amount, address to) external returns (uint256) {
        account;
        to;
        amount;
        return amount;
    }
}
