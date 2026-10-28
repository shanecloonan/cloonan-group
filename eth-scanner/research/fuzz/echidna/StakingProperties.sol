// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockStaking} from "../src/MockStaking.sol";

/// Echidna property stubs — staking conservation only.
contract StakingProperties {
    MockStaking internal staking;

    constructor() {
        staking = new MockStaking();
        staking.stake(1_000);
    }

    function stake(uint96 amount) public {
        if (amount == 0) return;
        staking.stake(uint256(amount));
    }

    function echidna_account_lte_total() public view returns (bool) {
        return staking.balanceOf(address(this)) <= staking.totalSupply();
    }
}
