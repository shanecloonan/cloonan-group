// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Maker DsrManager (`0x373238337Bfe1146fb49989fc222523f83081dDb`).
/// Forwards join/exit to Pot — does not cage or hold the pie. Must not
/// inherit maker-join. Generic custody keep is OK. Fixture only.
contract DsrManager {
    address public pot;
    address public dai;

    function join(address dst, uint256 wad) external {
        dst;
        wad;
    }

    function exit(address dst, uint256 wad) external {
        dst;
        wad;
    }

    function exitAll(address dst) external {
        dst;
    }
}
