// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Veda / ether.fi Liquid BoringVault (`0xf0bb…416C`). Holds the basket.
/// enter/exit/manage — not generic deposit/withdraw. Fixture only — not a finding.
contract BoringVault {
    function enter(address from, address asset, uint256 amount, uint256 shares) external {
        from;
        asset;
        amount;
        shares;
    }

    function exit(address to, address asset, uint256 amount, uint256 shares) external {
        to;
        asset;
        amount;
        shares;
    }

    function manage(address target, bytes calldata data, uint256 value) external returns (bytes memory) {
        target;
        data;
        value;
        return "";
    }
}
