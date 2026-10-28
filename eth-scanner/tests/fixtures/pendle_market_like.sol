// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Pendle Market holds SY/PT reserves. In-scope pool. Fixture only — not a finding.
/// Live ETH lock: wstETH 30DEC2027 `0x34280882267ffa6383b363e278b027be083bbe3b`.
contract PendleMarket {
    uint256 public expiry;
    uint256 public totalPt;
    uint256 public totalSy;

    function readState() external view returns (uint256) { return expiry; }

    function swapExactPtForSy(address receiver, uint256 exactPtIn, uint256 minSyOut) external returns (uint256) {
        receiver;
        exactPtIn;
        minSyOut;
        return minSyOut;
    }

    function swapSyForExactPt(address receiver, uint256 exactPtOut, uint256 maxSyIn) external returns (uint256) {
        receiver;
        exactPtOut;
        maxSyIn;
        return maxSyIn;
    }
}
