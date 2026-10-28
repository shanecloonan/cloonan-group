// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockLending} from "../src/MockLending.sol";

/// Echidna property stubs — lending solvency only.
contract LendingProperties {
    MockLending internal market;

    constructor() {
        market = new MockLending();
        market.supply(10_000);
    }

    function supply(uint96 amount) public {
        if (amount == 0) return;
        market.supply(uint256(amount));
    }

    function echidna_cash_plus_borrows() public view returns (bool) {
        return market.getCash() + market.totalBorrows() + 1 >= market.totalSupply();
    }
}
