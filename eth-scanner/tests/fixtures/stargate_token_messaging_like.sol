// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Stargate V2 TokenMessaging (`0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980`).
/// Bus/taxi packets only. lzReceive must not tag a lock-release bridge.
/// Liquidity sits on StargatePool. Fixture only — not a finding.
contract TokenMessaging {
    function driveBus(uint32 dstEid, bytes calldata passengers) external payable {
        dstEid;
        passengers;
    }

    function checkTickets(bytes32[] calldata ticketIds) external view returns (bool) {
        ticketIds;
        return true;
    }

    function encodeTaxi(address sender, uint256 amountLD) external pure returns (bytes memory) {
        sender;
        amountLD;
        return "";
    }

    function encodeBus(bytes calldata passengers) external pure returns (bytes memory) {
        passengers;
        return "";
    }

    function _lzReceive(bytes calldata payload) internal {
        payload;
    }
}
