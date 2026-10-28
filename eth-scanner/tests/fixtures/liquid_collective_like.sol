// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Liquid Collective LsETH impl (`0x0056…1a9D`; proxy `0x8c1B…6549`).
/// Consensus-layer deposits sit here. Fixture only — not a finding.
contract RiverV1 {
    function deposit() external payable {}

    function depositAndTransfer(address to) external payable {
        to;
    }

    function depositToConsensusLayerWithDepositRoot(uint256 count, bytes32 root) external {
        count;
        root;
    }

    function requestRedeem(uint256 amount, address owner) external returns (uint256) {
        owner;
        return amount;
    }

    function claimRedeemRequests(uint256[] calldata ids) external {
        ids;
    }

    function getRedeemManager() external view returns (address) {
        return address(0);
    }
}
