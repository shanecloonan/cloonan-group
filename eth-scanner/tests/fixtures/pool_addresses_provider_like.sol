// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sibling Proxy in the Aave/Spark Sourcify tree used to false-keep the
/// registry as diamond-facets-missing. Fixture only — not a finding.
contract InitializableAdminUpgradeabilityProxy {
    fallback() external payable {
        // empty — shape only
    }

    function _delegate(address impl) internal {
        impl;
    }
}

/// Aave V3 PoolAddressesProvider (`0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e`).
/// Registry, not a hold. Spark uses the same shape.
contract PoolAddressesProvider {
    function getPool() external view returns (address) {
        return address(0);
    }

    function getACLManager() external view returns (address) {
        return address(0);
    }

    function getACLAdmin() external view returns (address) {
        return address(0);
    }

    function getPoolConfigurator() external view returns (address) {
        return address(0);
    }

    function setPoolImpl(address poolImpl) external {
        poolImpl;
    }

    function setAddress(bytes32 id, address newAddress) external {
        id;
        newAddress;
    }

    function setACLManager(address manager) external {
        manager;
    }
}
