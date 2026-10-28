// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Resolv / Lombard Sourcify trees name the shell
/// `TransparentUpgradeableProxy` and also ship an Inception / Across-shaped
/// sibling with depositV3. That sibling is not this address. Prefer
/// diamond-facets-missing — do not steal as bridge. Fixture only.
contract TransparentUpgradeableProxy {
    address private _admin;
    address private _implementation;

    fallback() external payable {
        address impl = _implementation;
        assembly {
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
        }
    }

    function upgradeTo(address newImplementation) external {
        _implementation = newImplementation;
    }

    function admin() external view returns (address) {
        return _admin;
    }
}

/// Unrelated sibling in the same Sourcify tree. Must not flip the proxy.
contract InceptionBridge {
    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount
    ) external {
        depositor;
        recipient;
        inputToken;
        outputToken;
        inputAmount;
        outputAmount;
    }

    function fillV3Relay(bytes calldata relayData) external {
        relayData;
    }
}
