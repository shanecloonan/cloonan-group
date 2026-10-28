// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Maker-like VAT: wards + auth + frob/flux/move. Fixture only — not a finding.
contract Vat {
    mapping(address => uint256) public wards;
    mapping(address => uint256) public dai;

    function rely(address usr) external auth {
        wards[usr] = 1;
    }

    modifier auth() {
        require(wards[msg.sender] == 1, "Vat/not-authorized");
        _;
    }

    function frob(bytes32 i, address u, address v, address w, int dink, int dart) external auth {
        i; u; v; w; dink; dart;
    }

    function flux(bytes32 ilk, address src, address dst, uint256 wad) external {
        require(wish(src));
        ilk; dst; wad;
    }

    function move(address src, address dst, uint256 rad) external {
        require(wish(src));
        dai[src] = dai[src] - rad;
        dai[dst] = dai[dst] + rad;
    }

    function wish(address bit) internal view returns (bool) {
        return bit == msg.sender || wards[msg.sender] == 1;
    }
}
