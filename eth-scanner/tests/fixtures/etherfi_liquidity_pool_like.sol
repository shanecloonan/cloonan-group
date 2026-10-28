// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Imported EigenLayer IStrategy leak. `exchange` here must not steal
/// LiquidityPool as curve-pool. Fixture only — not a finding.
interface IStrategyLeak {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
}

/// ether.fi LiquidityPool impl (`0x17A1…4a45`; proxy `0x3088…F216`).
/// Holds ETH for eETH. Must be staking, not curve-pool.
/// Fixture only — not a finding.
contract LiquidityPool {
    IStrategyLeak public unusedStrategy;
    address public eETH;

    function deposit() external payable returns (uint256) {
        return msg.value;
    }

    function depositToRecipient(address recipient) external payable returns (uint256) {
        recipient;
        return msg.value;
    }

    function requestWithdraw(address recipient, uint256 amount) external returns (uint256) {
        recipient;
        amount;
        return 1;
    }

    function withdraw(address recipient, uint256 amount) external {
        recipient;
        amount;
    }

    function getTotalPooledEther() public view returns (uint256) {
        return address(this).balance;
    }

    function addEthAmountLockedForWithdrawal(uint256 amount) external {
        amount;
    }
}
