// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface JoinLike {
    function vat() external view returns (address);
    function join(address usr, uint256 wad) external;
    function exit(address usr, uint256 wad) external;
}

/// Sky DaiUsds (`0x3225737a9Bbb6473CB4A45b7244ACa2BeFdB276A`).
/// 1:1 converter through the Joins — nothing sits here.
/// Imported join/exit must not become maker-join. Fixture only.
contract DaiUsds {
    JoinLike public immutable daiJoin;
    JoinLike public immutable usdsJoin;
    address public immutable dai;
    address public immutable usds;

    constructor(address daiJoin_, address usdsJoin_, address dai_, address usds_) {
        daiJoin = JoinLike(daiJoin_);
        usdsJoin = JoinLike(usdsJoin_);
        dai = dai_;
        usds = usds_;
    }

    function daiToUsds(address usr, uint256 wad) external {
        usr;
        wad;
    }

    function usdsToDai(address usr, uint256 wad) external {
        usr;
        wad;
    }
}
