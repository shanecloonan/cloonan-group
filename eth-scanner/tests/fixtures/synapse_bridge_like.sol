// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// SynapseBridge impl (`0x5B00…005B`; proxy `0x2796…cEb6`).
/// Lock-mint-redeem. Must not win as eth-custody-withdraw.
/// Fixture only — not a finding.
contract SynapseBridge {
    mapping(bytes32 => bool) public kappaExists;

    function deposit(address to, uint256 chainId, address token, uint256 amount) external {
        to;
        chainId;
        token;
        amount;
    }

    function depositAndSwap(address to, uint256 chainId, address token, uint256 amount) external {
        to;
        chainId;
        token;
        amount;
    }

    function mintAndSwap(bytes32 kappa, address token, uint256 amount) external {
        kappa;
        token;
        amount;
    }

    function redeemV2(bytes32 kappa, address token, uint256 amount) external {
        kappa;
        token;
        amount;
    }

    function withdraw(address to, uint256 amount) external {
        to;
        amount;
        payable(msg.sender).transfer(address(this).balance);
    }
}
