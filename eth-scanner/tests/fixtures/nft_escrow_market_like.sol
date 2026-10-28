// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// NFT market that escrows ETH. Prefer false keep — funds sit here.
/// Fixture only — not a finding.
contract EscrowMarket {
    mapping(address => uint256) public pendingPayment;

    function depositETH() external payable {
        pendingPayment[msg.sender] += msg.value;
    }

    function withdrawETH(uint256 amount) external {
        pendingPayment[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function fulfillOrder(address seller, uint256 price) external payable {
        pendingPayment[seller] += price;
    }
}
