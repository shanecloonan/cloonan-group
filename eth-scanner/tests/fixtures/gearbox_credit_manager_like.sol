// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Gearbox CreditManagerV3 (`0x3EB95430FdB99439A86d3c6D7D01C3c561393556`).
/// Credit-account collateral sits here. Must be lending, not generic
/// custody. Fixture only — not a finding.
contract CreditManagerV3 {
    function openCreditAccount(address onBehalfOf) external returns (address) {
        return onBehalfOf;
    }

    function closeCreditAccount(address creditAccount) external {
        creditAccount;
    }

    function liquidateCreditAccount(
        address creditAccount,
        address to,
        bytes memory leftover
    ) external {
        creditAccount;
        to;
        leftover;
    }

    function manageDebt(address creditAccount, uint256 amount, bool increase) external {
        creditAccount;
        amount;
        increase;
    }

    function addCollateral(address payer, address creditAccount, address token, uint256 amount) external {
        payer;
        creditAccount;
        token;
        amount;
    }

    function withdrawCollateral(address creditAccount, address token, uint256 amount, address to) external {
        creditAccount;
        token;
        amount;
        to;
    }
}
