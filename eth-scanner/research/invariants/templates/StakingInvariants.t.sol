// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Defensive staking stubs. Conservation inequalities only — no unstake attacks.
interface IStakingLike {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract StakingInvariants {
    IStakingLike internal staking;
    address internal probe;

    function test_template_stake_nonnegative() public view {
        staking.totalSupply();
        if (probe != address(0)) {
            staking.balanceOf(probe);
        }
    }

    /// A single account's stake cannot exceed total staked shares.
    function test_template_account_lte_total() public view {
        if (probe == address(0)) return;
        assert(staking.balanceOf(probe) <= staking.totalSupply());
    }
}
