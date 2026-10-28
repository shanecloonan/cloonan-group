// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Maker / Sky Pot (`0x197E…cf7`). DSR pie accounting — vault, not generic
/// custody. Fixture only — not a finding.
contract Pot {
    mapping(address => uint256) public pie;
    uint256 public chi;
    uint256 public dsr;
    uint256 public rho;
    address public vat;
    mapping(address => uint256) public wards;

    function join(uint256 wad) external {
        pie[msg.sender] += wad;
    }

    function exit(uint256 wad) external {
        pie[msg.sender] -= wad;
    }

    function drip() external returns (uint256) {
        return chi;
    }
}
