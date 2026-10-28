// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockLending} from "../src/MockLending.sol";

/// Defensive Foundry fuzz: cash + borrows covers supply (1 wei slack).
contract LendingSolvency {
    MockLending internal market;

    constructor() {
        market = new MockLending();
        market.supply(10_000);
    }

    function setUp() public {
        if (address(market) == address(0)) {
            market = new MockLending();
            market.supply(10_000);
        }
    }

    function testFuzz_supplyKeepsSolvency(uint96 amount) public {
        if (amount == 0) return;
        market.supply(uint256(amount));
        assert(market.getCash() + market.totalBorrows() + 1 >= market.totalSupply());
    }

    function testFuzz_borrowRepayKeepsSolvency(uint96 amount) public {
        uint256 cash = market.getCash();
        if (cash == 0) return;
        uint256 take = uint256(amount) % (cash + 1);
        if (take == 0) return;
        market.borrow(take);
        assert(market.getCash() + market.totalBorrows() + 1 >= market.totalSupply());
        market.repay(take);
        assert(market.getCash() + market.totalBorrows() + 1 >= market.totalSupply());
    }

    function invariant_cashPlusBorrows() public view {
        assert(market.getCash() + market.totalBorrows() + 1 >= market.totalSupply());
    }

    function check_cashPlusBorrows() public view {
        assert(market.getCash() + market.totalBorrows() + 1 >= market.totalSupply());
    }
}
