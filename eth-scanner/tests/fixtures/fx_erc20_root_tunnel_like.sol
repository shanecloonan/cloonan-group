// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Polygon FxERC20RootTunnel (`0x0cc2…7f2c`). deposit + receiveMessage hold
/// and release ERC-20 on L1. Must be *bridge*, not generic custody.
/// Fixture only — not a finding.
contract FxERC20RootTunnel {
    mapping(address => address) public rootToChildToken;

    function mapToken(address rootToken) public {
        rootToken;
    }

    function deposit(address rootToken, address user, uint256 amount) public {
        rootToken;
        user;
        amount;
    }

    function receiveMessage(bytes memory inputData) public {
        inputData;
    }

    function _processMessageFromChild(bytes memory data) internal {
        data;
    }

    function sendMessageToChild(bytes memory message) internal {
        message;
    }
}
