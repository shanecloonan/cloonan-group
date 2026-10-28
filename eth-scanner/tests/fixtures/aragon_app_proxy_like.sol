// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Lido stETH proxy (`0xae7a…e84`) is AppProxyUpgradeable. Aragon uses
/// delegatedFwd — not OZ delegatecall+fallback — so the shell used to
/// cool as utility. Sibling Lido submit must not steal as staking.
/// Fixture only — not a finding.
contract AppProxyUpgradeable {
    function implementation() external view returns (address) {
        return address(0);
    }

    function delegatedFwd(address app, bytes memory data) internal {
        app;
        data;
    }

    function isDepositable() external view returns (bool) {
        return true;
    }

    function setDepositable(bool) external {}

    function proxyType() external pure returns (uint256) {
        return 2;
    }
}

contract LidoSibling {
    function submit(address referral) external payable returns (uint256) {
        referral;
        return msg.value;
    }

    function getPooledEthByShares(uint256 shares) external view returns (uint256) {
        return shares;
    }
}
