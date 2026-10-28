// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// crvUSD Controller (`0x4e59…5c67` WBTC market). create_loan / repay /
/// liquidate. Must be lending. Fixture only — not a finding.
contract crvUSDController {
    function create_loan(uint256 collateral, uint256 debt, uint256 n_bands) external payable {
        collateral;
        debt;
        n_bands;
    }

    function create_loan_extended(uint256 collateral, uint256 debt, uint256 n_bands, address callbacker, uint256[] memory callback_args) external payable {
        collateral;
        debt;
        n_bands;
        callbacker;
        callback_args;
    }

    function borrow_more(uint256 collateral, uint256 debt) external payable {
        collateral;
        debt;
    }

    function repay(uint256 amount) external {
        amount;
    }

    function repay_extended(address callbacker, uint256[] memory callback_args) external {
        callbacker;
        callback_args;
    }

    function liquidate(address user, uint256 min_x) external {
        user;
        min_x;
    }

    function liquidate_extended(address user, uint256 min_x, uint256 frac, address callbacker, uint256[] memory callback_args) external {
        user;
        min_x;
        frac;
        callbacker;
        callback_args;
    }
}
