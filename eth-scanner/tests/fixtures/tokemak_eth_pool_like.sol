// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Tokemak EthPool impl (`0xb104…46d5`; proxy `0xD3D1…2F36`).
/// Reactor holds ETH. approveManager + requestedWithdrawals.
/// Must not steal Origin requestWithdrawal. Fixture only — not a finding.
contract EthPool {
    mapping(address => uint256) public requestedWithdrawals;

    function deposit(uint256 amount) external payable {
        amount;
    }

    function depositFor(address recipient, uint256 amount) external payable {
        recipient;
        amount;
    }

    function requestWithdrawal(uint256 amount) external {
        amount;
        requestedWithdrawals[msg.sender] = amount;
    }

    function withdraw(uint256 amount) external {
        amount;
    }

    function approveManager(uint256 amount) external {
        amount;
    }
}
