// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal market for defensive solvency fuzz.
/// cash + borrows covers supplied liquidity (1 wei slack is applied in tests).
contract MockLending {
    uint256 public totalSupply;
    uint256 public totalBorrows;
    uint256 public totalReserves;
    uint256 public cash;

    function getCash() public view returns (uint256) {
        return cash;
    }

    function supply(uint256 amount) public {
        require(amount > 0, "amount");
        cash += amount;
        totalSupply += amount;
    }

    function borrow(uint256 amount) public {
        require(amount > 0 && cash >= amount, "cash");
        cash -= amount;
        totalBorrows += amount;
    }

    function repay(uint256 amount) public {
        require(amount > 0 && totalBorrows >= amount, "borrows");
        cash += amount;
        totalBorrows -= amount;
    }

    function accrueReserve(uint256 amount) public {
        require(amount > 0 && cash >= amount, "cash");
        cash -= amount;
        totalReserves += amount;
        if (totalSupply >= amount) {
            totalSupply -= amount;
        }
    }
}
