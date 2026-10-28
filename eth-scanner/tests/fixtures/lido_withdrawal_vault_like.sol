// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Lido WithdrawalVault impl (`0xfB45…7340`; proxy `0xB9D7…293f`).
/// Beacon ETH sits here until Lido pulls it.
/// withdrawWithdrawals + addWithdrawalRequests — not WithdrawalQueue.
/// Fixture only — not a finding.
contract WithdrawalVault {
    address public LIDO;

    function withdrawWithdrawals(uint256 amount) external {
        amount;
    }

    function addWithdrawalRequests(bytes[] calldata pubkeys, uint64[] calldata amounts) external payable {
        pubkeys;
        amounts;
    }

    function recoverERC20(address token, uint256 amount) external {
        token;
        amount;
    }
}
