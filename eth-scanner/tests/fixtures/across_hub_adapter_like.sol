// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Across HubPool Etherscan impl can be Ethereum_Adapter (facet-like).
/// `relayTokens` is still a bridge surface. Fixture only — not a finding.
contract Ethereum_Adapter {
    function relayTokens(address l1Token, address l2Token, uint256 amount, address to) external {
        l1Token;
        l2Token;
        amount;
        to;
    }
}
