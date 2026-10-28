// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Celer cBridge (`0x5427…1820`). Liquidity lock + signed withdraw.
/// Must not stay generic custody.
/// Fixture only — not a finding.
contract Bridge {
    function addNativeLiquidity() external payable {}

    function sendNative(address receiver, uint64 dstChainId) external payable {
        receiver;
        dstChainId;
    }

    function decWithdrawMsg(bytes calldata message) external {
        message;
    }

    function decRelay(bytes calldata message) external {
        message;
    }

    function withdraw(bytes calldata wdmsg, bytes[] calldata sigs) external {
        wdmsg;
        sigs;
    }
}
