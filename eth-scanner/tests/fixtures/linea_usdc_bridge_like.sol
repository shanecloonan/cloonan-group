// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Linea L1USDCBridge impl (`0x66CF…Df00`; proxy `0x504A…88ce`).
/// Native USDC lock on L1. receiveFromOtherLayer + burnAllLockedUSDC.
/// Must not steal TokenBridge. Fixture only — not a finding.
contract L1USDCBridge {
    uint256 public balance;
    address public remoteUSDCBridge;

    function deposit(uint256 amount) external payable {
        amount;
    }

    function depositTo(uint256 amount, address to) external payable {
        amount;
        to;
    }

    function receiveFromOtherLayer(address recipient, uint256 amount) external {
        recipient;
        amount;
    }

    function burnAllLockedUSDC() external {
        balance = 0;
    }

    function setRemoteUSDCBridge(address remote) external {
        remoteUSDCBridge = remote;
    }
}
