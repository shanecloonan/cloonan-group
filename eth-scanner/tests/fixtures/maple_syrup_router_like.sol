// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Maple SyrupRouter (`0x134cCaaA4F1e4552eC8aEcb9E4A2360dDcF8df76`).
/// Permissioned entry: pull assets, deposit into MaplePool, route shares back.
/// Must cool as a router. Fixture only — not a finding.
contract SyrupRouter {
    address public pool;
    address public poolPermissionManager;

    function authorizeAndDeposit(
        uint256 bitmap,
        uint256 deadline,
        uint8 authV,
        bytes32 authR,
        bytes32 authS,
        uint256 amount,
        bytes32 depositData
    ) external returns (uint256 shares) {
        bitmap;
        deadline;
        authV;
        authR;
        authS;
        amount;
        depositData;
        return 0;
    }

    function authorizeAndDepositWithPermit(
        uint256 bitmap,
        uint256 deadline,
        uint8 authV,
        bytes32 authR,
        bytes32 authS,
        uint256 amount,
        bytes32 depositData,
        uint8 permitV,
        bytes32 permitR,
        bytes32 permitS
    ) external returns (uint256 shares) {
        bitmap;
        deadline;
        authV;
        authR;
        authS;
        amount;
        depositData;
        permitV;
        permitR;
        permitS;
        return 0;
    }

    function deposit(uint256 amount, bytes32 depositData) external returns (uint256 shares) {
        amount;
        depositData;
        return 0;
    }

    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes32 depositData
    ) external returns (uint256 shares) {
        amount;
        deadline;
        v;
        r;
        s;
        depositData;
        return 0;
    }
}
