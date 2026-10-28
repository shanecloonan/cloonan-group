// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Linea TokenBridge impl (`0xF0e0…e3ff`; proxy `0x051F…3319`).
/// Escrow native tokens and mint bridged representations.
/// Fixture only — not a finding.
contract TokenBridge {
    mapping(address => address) public nativeToBridgedToken;
    mapping(address => address) public bridgedToNativeToken;

    function bridgeToken(address token, uint256 amount, address to) external {
        token;
        amount;
        to;
    }

    function bridgeTokenWithPermit(address token, uint256 amount, address to) external {
        token;
        amount;
        to;
    }

    function completeBridging(address nativeToken, uint256 amount, address to) external {
        nativeToken;
        amount;
        to;
    }
}
