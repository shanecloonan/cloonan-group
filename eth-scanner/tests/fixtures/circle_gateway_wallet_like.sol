// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Circle GatewayWallet impl (`0xF7a6…e798`; proxy `0x7777…00eE`).
/// USDC lock for cross-domain mint. gatewayBurn + initiateWithdrawal —
/// not Sonic withdrawWhileDead / Linea burnAllLockedUSDC.
/// Fixture only — not a finding.
contract GatewayWallet {
    uint256 public withdrawalDelay;

    function deposit(address token, uint256 value) external {
        token;
        value;
    }

    function depositFor(address token, address depositor, uint256 value) external {
        token;
        depositor;
        value;
    }

    function gatewayBurn(bytes calldata calldataBytes, bytes calldata signature) external {
        calldataBytes;
        signature;
    }

    function initiateWithdrawal(address token, uint256 value) external {
        token;
        value;
    }

    function withdraw(address token) external {
        token;
    }
}
