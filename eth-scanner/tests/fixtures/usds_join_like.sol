// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface VatUsds {
    function frob(bytes32 i, address u, address v, address w, int dink, int dart) external;
    function move(address src, address dst, uint256 rad) external;
}

interface UsdsLike {
    function mint(address usr, uint256 wad) external;
    function burn(address usr, uint256 wad) external;
}

/// Sky UsdsJoin (`0x3C0f895007CA717Aa01c8693e59DF1e8C3777FEB`).
/// Same hold as DaiJoin but no cage. Sibling Vat.frob must not win.
/// Fixture only — not a finding.
contract UsdsJoin {
    VatUsds public immutable vat;
    UsdsLike public immutable usds;

    constructor(address vat_, address usds_) {
        vat = VatUsds(vat_);
        usds = UsdsLike(usds_);
    }

    function join(address usr, uint256 wad) external {
        vat.move(address(this), usr, wad);
        usds.burn(msg.sender, wad);
    }

    function exit(address usr, uint256 wad) external {
        vat.move(usr, address(this), wad);
        usds.mint(usr, wad);
    }

    function dai() external view returns (address) {
        return address(usds);
    }
}
