// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sonic Gateway TokenDeposit impl (`0xAdE2…ADe9`; proxy `0xa1E2…ec20`).
/// L1 ERC-20 lock. withdrawWhileDead + cancelDepositWhileDead —
/// not Linea burnAllLockedUSDC. Fixture only — not a finding.
contract TokenDeposit {
    address public bridge;
    address public exitAdministrator;

    function deposit(uint96 uid, address token, uint256 amount) external {
        uid;
        token;
        amount;
    }

    function claim(uint256 id, address token, uint256 amount, bytes calldata proof) external {
        id;
        token;
        amount;
        proof;
    }

    function claimFor(uint256 id, address user, address token, uint256 amount, bytes calldata proof) public {
        id;
        user;
        token;
        amount;
        proof;
    }

    function withdrawWhileDead(address recipient, address token, uint256 amount) external {
        recipient;
        token;
        amount;
    }

    function cancelDepositWhileDead(uint256 id, address token, uint256 amount, bytes calldata proof) external {
        id;
        token;
        amount;
        proof;
    }

    function burnLockedUSDC() external {}
}
