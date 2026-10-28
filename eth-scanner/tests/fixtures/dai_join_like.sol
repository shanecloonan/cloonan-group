// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sibling Vat in the same flatten used to steal DaiJoin as maker-vat.
/// Fixture only — not a finding.
interface Vat {
    function frob(bytes32 i, address u, address v, address w, int dink, int dart) external;
    function slip(bytes32 ilk, address usr, int256 wad) external;
    function move(address src, address dst, uint256 rad) external;
}

interface Dai {
    function mint(address usr, uint256 wad) external;
    function burn(address usr, uint256 wad) external;
}

/// Maker DaiJoin (`0x9759A6Ac90977b93B58547b4A71c78317f391A28`).
/// Holds DAI and joins it into Vat. Must be vault / maker-join, not generic
/// custody and not sibling Vat. Fixture only — not a finding.
contract DaiJoin {
    Vat public vat;
    Dai public dai;
    uint256 public live;

    function cage() external {
        live = 0;
    }

    function join(address usr, uint256 wad) external {
        dai.burn(msg.sender, wad);
        vat.move(address(this), usr, wad);
    }

    function exit(address usr, uint256 wad) external {
        vat.move(usr, address(this), wad);
        dai.mint(usr, wad);
    }
}
