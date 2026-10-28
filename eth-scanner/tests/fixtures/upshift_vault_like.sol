// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Upshift institutional vault (`0x3EAa…8DFC`). Holds deposits.
/// lockCapital + claimDailyInterest — not generic deposit/withdraw.
/// Fixture only — not a finding.
contract Vault {
    function deposit(uint256 amount) external {
        amount;
    }

    function withdraw(uint256 amount) external {
        amount;
    }

    function lockCapital() external {}

    function claimDailyInterest() external {}

    function getDeployableCapital() external view returns (uint256) {
        return 0;
    }

    function getTotalDeposited() external view returns (uint256) {
        return 0;
    }

    function emergencyWithdraw() external {}
}
