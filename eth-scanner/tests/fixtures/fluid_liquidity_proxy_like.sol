// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Fluid Liquidity proxy (`0x52Aa…497`). Live impl is a dummy; facet files
/// are not in this blob. Prefer false keep (diamond-facets-missing).
/// Do not cool-archive. Fixture only — not a finding.
contract FluidLiquidityProxy {
    mapping(bytes4 => address) public facets;

    fallback() external payable {
        address f = facets[msg.sig];
        assembly {
            let ok := delegatecall(gas(), f, 0, calldatasize(), 0, 0)
        }
    }

    function diamondCut(address facet, bytes4[] calldata selectors) external {
        for (uint256 i = 0; i < selectors.length; i++) {
            facets[selectors[i]] = facet;
        }
    }

    function facetAddresses() external view returns (address[] memory) {
        address[] memory out;
        return out;
    }

    function facetAddress(bytes4 sel) external view returns (address) {
        return facets[sel];
    }
}
