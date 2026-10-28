// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Reserve FolioDeployer (`0x4D20…2073`). Factory — Folios hold the basket.
/// Must cool as utility. Fixture only — not a finding.
contract FolioDeployer {
    address public folioImplementation;

    function deployFolio(
        address owner,
        address[] memory basketManagers,
        bytes32 deploymentNonce
    ) public returns (address folio, address proxyAdmin) {
        owner;
        basketManagers;
        deploymentNonce;
        return (folioImplementation, address(0));
    }

    function deployGovernedFolio(
        address stToken,
        address owner,
        bytes32 deploymentNonce
    ) external returns (address folio, address proxyAdmin) {
        stToken;
        return deployFolio(owner, new address[](0), deploymentNonce);
    }
}
