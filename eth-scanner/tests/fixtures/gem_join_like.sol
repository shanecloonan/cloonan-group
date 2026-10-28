// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface VatGem {
    function frob(bytes32 i, address u, address v, address w, int dink, int dart) external;
    function slip(bytes32 ilk, address usr, int256 wad) external;
}

interface Gem {
    function transferFrom(address src, address dst, uint256 wad) external returns (bool);
    function transfer(address dst, uint256 wad) external returns (bool);
}

/// Maker ETHJoin / GemJoin (`0x2F0b23f53734252Bda2277357e97e1517d6B042A`).
/// Holds the gem. Sibling Vat.frob must not win. Fixture only — not a finding.
contract GemJoin {
    VatGem public vat;
    Gem public gem;
    bytes32 public ilk;
    uint256 public live;

    function cage() external {
        live = 0;
    }

    function join(address usr, uint256 wad) external payable {
        gem.transferFrom(msg.sender, address(this), wad);
        vat.slip(ilk, usr, int256(wad));
    }

    function exit(address usr, uint256 wad) external {
        vat.slip(ilk, msg.sender, -int256(wad));
        gem.transfer(usr, wad);
    }
}
