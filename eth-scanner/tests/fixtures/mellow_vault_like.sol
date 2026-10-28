// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Mellow ALM vault (`0x7600…bb84`). Holds vault tokens.
/// transferAndPush + reclaimTokens. Fixture only — not a finding.
contract MellowVault {
    function transferAndPush(uint256[] memory amounts) external {
        amounts;
    }

    function reclaimTokens(address token) external {
        token;
    }

    function pull(uint256[] memory amounts) external {
        amounts;
    }

    function push(uint256[] memory amounts) external {
        amounts;
    }

    function tvl() external view returns (uint256) {
        return 0;
    }

    function isVaultToken(address token) external view returns (bool) {
        token;
        return true;
    }
}
