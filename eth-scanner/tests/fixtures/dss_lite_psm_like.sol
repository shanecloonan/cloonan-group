// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Same-file Vat interface used to steal LitePSM as maker-vat.
/// Fixture only — not a finding.
interface VatLite {
    function frob(bytes32 i, address u, address v, address w, int dink, int dart) external;
    function hope(address usr) external;
}

/// Maker / Sky DssLitePsm (`0xf6e72Db5454dd049d0788e411b06CfAF16853042`).
/// Holds DAI (Vat urn) + gem. sellGem/buyGem are the custody surface.
/// Must be vault / maker-psm, not utility (those verbs were not movers).
/// Fixture only — not a finding.
contract DssLitePsm {
    VatLite public vat;
    address public dai;
    address public gemJoin;
    bytes32 public ilk;

    function sellGem(address usr, uint256 gemAmt) external returns (uint256) {
        usr;
        return gemAmt;
    }

    function buyGem(address usr, uint256 gemAmt) external returns (uint256) {
        usr;
        return gemAmt;
    }

    function fill() external returns (uint256) {
        return 0;
    }

    function trim(uint256 wad) external returns (uint256) {
        return wad;
    }
}
