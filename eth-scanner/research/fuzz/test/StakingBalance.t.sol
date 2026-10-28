// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockStaking} from "../src/MockStaking.sol";

/// Defensive Foundry fuzz: an account's stake cannot exceed totalSupply.
contract StakingBalance {
    MockStaking internal staking;

    constructor() {
        staking = new MockStaking();
        staking.stake(1_000);
    }

    function setUp() public {
        if (address(staking) == address(0)) {
            staking = new MockStaking();
            staking.stake(1_000);
        }
    }

    function testFuzz_stakeAccountLteTotal(uint96 amount) public {
        if (amount == 0) return;
        staking.stake(uint256(amount));
        assert(staking.balanceOf(address(this)) <= staking.totalSupply());
    }

    function testFuzz_unstakePreservesInequality(uint96 amount) public {
        uint256 bal = staking.balanceOf(address(this));
        if (bal == 0) return;
        uint256 take = uint256(amount) % (bal + 1);
        if (take == 0) return;
        staking.unstake(take);
        assert(staking.balanceOf(address(this)) <= staking.totalSupply());
    }

    function invariant_accountLteTotal() public view {
        assert(staking.balanceOf(address(this)) <= staking.totalSupply());
    }

    function check_accountLteTotal() public view {
        assert(staking.balanceOf(address(this)) <= staking.totalSupply());
    }
}
