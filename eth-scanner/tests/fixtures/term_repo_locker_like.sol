// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// TermRepoLocker impl (`0xFCf4…86e`). Token piggy-bank for a Term repo.
/// Fixture only — not a finding.
contract TermRepoLocker {
    bytes32 public termRepoId;

    function transferTokenFromWallet(address token, address wallet, uint256 amount) external {
        token;
        wallet;
        amount;
    }

    function transferTokenToWallet(address token, address wallet, uint256 amount) external {
        token;
        wallet;
        amount;
    }

    function pairTermContracts(address servicer, address collateralManager) external {
        servicer;
        collateralManager;
    }
}
