// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRocketVault {
    function depositEther() external payable;
}

/// Rocket DepositPool (`0x2cac…Bfb4`). Holds ETH for minipool assignment.
/// `_rocketVault.depositEther{value}` must not steal *bridge*. Fixture only.
contract RocketDepositPool {
    IRocketVault public rocketVault;

    function deposit() external payable {
        rocketVault.depositEther{value: msg.value}();
    }

    function assignDeposits() external {}

    function getExcessBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function receiveVaultWithdrawalETH() external payable {}

    function recycleLiquidatedStake() external payable {}

    function withdrawExcessBalance(uint256 amount) external {
        amount;
    }
}
