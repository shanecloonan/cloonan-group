// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Stargate V2 PoolUSDC (`0xc026395860Db2d07ee33e05fE50ed7bD583189C7`).
/// Liquidity lock. Must stay bridge. Fixture only — not a finding.
contract StargatePoolUSDC {
    function deposit(address receiver, uint256 amountLD) external payable returns (uint256) {
        receiver;
        return amountLD;
    }

    function redeem(uint64 amountSD, address receiver) external returns (uint256) {
        receiver;
        return amountSD;
    }

    function rideBus(
        uint32 dstEid,
        uint256 amountLD,
        address receiver
    ) external payable {
        dstEid;
        amountLD;
        receiver;
    }

    function addTreasuryFee(uint256 amountLD) external {
        amountLD;
    }

    function lzReceive(bytes calldata payload) external {
        payload;
    }
}
