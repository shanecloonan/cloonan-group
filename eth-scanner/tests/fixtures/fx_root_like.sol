// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Polygon FxRoot (`0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2`).
/// Messaging only — no token lock. Must stay *utility*, not bridge.
/// Fixture only — not a finding.
contract FxRoot {
    address public fxChild;

    function setFxChild(address _fxChild) external {
        fxChild = _fxChild;
    }

    function sendMessageToChild(address receiver, bytes calldata data) external {
        receiver;
        data;
    }
}
