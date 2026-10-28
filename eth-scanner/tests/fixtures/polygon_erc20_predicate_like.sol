// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20P {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Polygon PoS ERC20Predicate impl (`0x1f4c1e0afbeb5b5b86d7722549274434b29884f6`).
/// Proxy `0x40ec…bbDf`. lockTokens / exitTokens escrow ERC-20. Fixture only.
contract ERC20Predicate {
    function lockTokens(address depositor, address depositReceiver, address rootToken, bytes calldata depositData) external {
        IERC20P(rootToken).transferFrom(depositor, address(this), 1);
        depositor;
        depositReceiver;
        depositData;
    }

    function exitTokens(address sender, address rootToken, bytes calldata logRLP) external {
        IERC20P(rootToken).transfer(sender, 1);
        logRLP;
    }
}
