// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// CoW Protocol GPv2Settlement (`0x9008D19f58AAbD9eD0D60971565AA8510560ab41`).
/// Atomic batch settle — tokens flash through, they do not sit.
/// Must cool as pass-through. Uni V4 PoolManager has settle+swap without
/// invalidateOrder and must stay a pool. Fixture only — not a finding.
contract GPv2Settlement {
    function settle(
        address[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata trades,
        bytes calldata interactions
    ) external {
        tokens;
        clearingPrices;
        trades;
        interactions;
    }

    function swap(
        address[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata trade
    ) external {
        tokens;
        clearingPrices;
        trade;
    }

    function invalidateOrder(bytes calldata orderUid) external {
        orderUid;
    }
}
