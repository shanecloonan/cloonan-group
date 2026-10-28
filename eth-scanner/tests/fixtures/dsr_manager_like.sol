// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live DsrManager (`0x373238337Bfe1146fb49989fc222523f83081dDb`)
/// Sourcify flatten. PotLike.vat / JoinLike.join must not steal maker-join.
/// Forwards DAI into Pot. Generic custody keep. Fixture only.
interface PotLike {
    function vat() external view returns (address);
    function chi() external view returns (uint256);
    function rho() external view returns (uint256);
    function drip() external returns (uint256);
    function join(uint256 pie) external;
    function exit(uint256 pie) external;
}

interface JoinLike {
    function dai() external view returns (address);
    function join(address usr, uint256 wad) external;
    function exit(address usr, uint256 wad) external;
}

interface GemLike {
    function transferFrom(address src, address dst, uint256 wad) external returns (bool);
    function approve(address usr, uint256 wad) external returns (bool);
}

contract DsrManager {
    PotLike public pot;
    GemLike public dai;
    JoinLike public daiJoin;
    uint256 public supply;
    mapping(address => uint256) public pieOf;

    function daiBalance(address usr) external view returns (uint256 wad) {
        usr;
        return 0;
    }

    function join(address dst, uint256 wad) external {
        pieOf[dst] += wad;
        supply += wad;
        dai.transferFrom(msg.sender, address(this), wad);
        daiJoin.join(address(this), wad);
        pot.join(wad);
    }

    function exit(address dst, uint256 wad) external {
        pieOf[msg.sender] -= wad;
        supply -= wad;
        pot.exit(wad);
        daiJoin.exit(dst, wad);
    }

    function exitAll(address dst) external {
        uint256 pie = pieOf[msg.sender];
        pieOf[msg.sender] = 0;
        supply -= pie;
        pot.exit(pie);
        daiJoin.exit(dst, pie);
    }
}
