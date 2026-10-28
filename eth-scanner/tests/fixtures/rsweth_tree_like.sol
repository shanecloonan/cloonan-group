// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Same-file sibling: RswETH + EigenLayer IDelegationManager iface.
/// Live flatten used to win as *eigenlayer* via full-src regex. Fixture only.
interface IDelegationManager {
    function depositIntoStrategy(address strategy, address token, uint256 amount) external returns (uint256);
    function queueWithdrawals(bytes calldata queuedWithdrawalParams) external returns (bytes32[] memory);
    function completeQueuedWithdrawal(bytes calldata withdrawal, address[] calldata tokens, bool receiveAsTokens) external;
    function undelegate(address staker) external returns (bytes32[] memory);
}

contract RswETH {
    string public name = "rswETH";
    string public symbol = "rswETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    uint256 public rswETHToETHRate;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }
    function transferFrom(address, address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    function reprice(uint256 newRate) external {
        rswETHToETHRate = newRate;
    }

    function burn(uint256 amount) external {
        amount;
    }
}
