// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Polygon PoS EtherPredicate impl (`0xeb185ed8f664d105903ef434e5becd214a8ac874`).
/// Proxy `0x8484…2B30`. lockTokens / exitTokens hold and release ETH.
/// Must be *bridge*, not generic custody. Fixture only — not a finding.
contract EtherPredicate {
    function lockTokens(address depositor, address depositReceiver, address rootToken, bytes calldata depositData) external payable {
        depositor;
        depositReceiver;
        rootToken;
        depositData;
    }

    function exitTokens(address sender, address rootToken, bytes calldata logRLP) external {
        sender;
        rootToken;
        logRLP;
    }
}
