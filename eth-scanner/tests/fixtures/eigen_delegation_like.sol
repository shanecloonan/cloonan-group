// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStrategy {
    function deposit(address token, uint256 amount) external returns (uint256);
    function withdraw(address token, address to, uint256 amount) external;
    function totalShares() external view returns (uint256);
}

/// Live EigenLayer DelegationManager shape (`0x3905…f37A`).
/// Imported IStrategy.deposit/totalShares must not vault-tag + auto-close.
/// Fixture only — not a finding.
contract DelegationManager {
    mapping(address => address) public delegatedTo;

    function delegateTo(address operator) public {
        delegatedTo[msg.sender] = operator;
    }

    function undelegate(address staker) public returns (bytes32) {
        delegatedTo[staker] = address(0);
        return bytes32(0);
    }

    function queueWithdrawals(address[] calldata strategies, uint256[] calldata shares) external returns (bytes32) {
        strategies;
        shares;
        return bytes32(uint256(1));
    }

    function completeQueuedWithdrawal(address staker, bool receiveAsTokens) external {
        staker;
        receiveAsTokens;
    }
}
