// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Defensive lending stubs. Solvency inequalities only — no liquidation bots.
interface ILendingLike {
    function totalSupply() external view returns (uint256);
    function totalBorrows() external view returns (uint256);
    function totalReserves() external view returns (uint256);
    function getCash() external view returns (uint256);
}

contract LendingInvariants {
    ILendingLike internal market;

    /// Cash + borrows should cover supply minus reserves, with slack.
    /// Implementations differ; treat as a shape to instantiate, not a verdict.
    function test_template_cash_plus_borrows() public view {
        uint256 cash = market.getCash();
        uint256 borrows = market.totalBorrows();
        uint256 supply = market.totalSupply();
        uint256 reserves = market.totalReserves();
        assert(cash + borrows + 1 >= supply);
        reserves;
    }

    function test_template_borrows_readable() public view {
        market.totalBorrows();
        market.totalSupply();
    }
}
