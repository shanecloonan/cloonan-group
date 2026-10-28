// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Liquity V2 StabilityPool (`0x5721cbbd64fc7ae3ef44a0a3f9a790a9264cf9bf` WETH).
/// BOLD deposits sit here and are offset against liquidations. Must be vault,
/// not generic custody. Fixture only — not a finding.
contract StabilityPool {
    function provideToSP(uint256 topUp, bool doClaim) external {
        topUp;
        doClaim;
    }

    function withdrawFromSP(uint256 amount, bool doClaim) external {
        amount;
        doClaim;
    }

    function claimAllCollGains() external {}

    function offset(uint256 debtToOffset, uint256 collToAdd) external {
        debtToOffset;
        collToAdd;
    }
}
