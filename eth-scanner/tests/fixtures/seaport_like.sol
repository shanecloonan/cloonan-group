// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Seaport-shaped atomic settlement. Does not hold funds — demote as nft-market.
/// Fixture only — not a finding.
contract SeaportLike {
    function fulfillOrder(address offerer, address recipient, uint256 price) external payable {
        offerer;
        recipient;
        price;
    }

    function fulfillBasicOrder(address offerer, uint256 price) external payable {
        offerer;
        price;
    }

    function matchOrders(bytes calldata orders) external payable {
        orders;
    }
}
