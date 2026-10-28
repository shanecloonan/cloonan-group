// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Mellow ERC20RootVault (`0xa1ee…dd00`). Holds the multi-subvault basket.
/// hasSubvault + addDepositorsToAllowlist. Fixture only — not a finding.
contract ERC20RootVault {
    function deposit(uint256[] memory tokenAmounts, uint256 minLpTokens, bytes memory options)
        external
        returns (uint256[] memory actualTokenAmounts)
    {
        tokenAmounts;
        minLpTokens;
        options;
        actualTokenAmounts = new uint256[](0);
    }

    function withdraw(
        address to,
        uint256 lpTokenAmount,
        uint256[] memory minTokenAmounts,
        bytes[] memory vaultsOptions
    ) external returns (uint256[] memory actualTokenAmounts) {
        to;
        lpTokenAmount;
        minTokenAmounts;
        vaultsOptions;
        actualTokenAmounts = new uint256[](0);
    }

    function hasSubvault(address vault) external view returns (bool) {
        vault;
        return true;
    }

    function subvaultNfts() external view returns (uint256[] memory) {
        return new uint256[](0);
    }

    function addDepositorsToAllowlist(address[] memory depositors) external {
        depositors;
    }

    function removeDepositorsFromAllowlist(address[] memory depositors) external {
        depositors;
    }
}
