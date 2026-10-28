// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20D {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Thin diamond / loupe. Etherscan ContractName=Diamond misses facet files
/// unless we prefer false keep. Vault facet holds funds. Fixture only — not a finding.
contract Diamond {
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
}

contract VaultFacet {
    IERC20D public token;

    function deposit(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external {
        amount;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares;
    }

    function totalAssets() public view returns (uint256) { return 1; }
}
