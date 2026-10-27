// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Utility — no token/ETH movers. Used only to exercise S4 "no movers".
contract MathLib {
    function add(uint256 a, uint256 b) external pure returns (uint256) {
        return a + b;
    }

    function version() external pure returns (string memory) {
        return "1";
    }
}
