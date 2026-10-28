// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library SharesMathLib {
    function toSharesDown(uint256 assets, uint256 totalAssets, uint256 totalShares) internal pure returns (uint256) {
        return assets + totalAssets + totalShares;
    }
}

/// Live Morpho Blue (`0xBBBB…FFCb`) shape. Lending — not vault from `totalAssets` params.
/// Fixture only — not a finding.
contract Morpho {
    using SharesMathLib for uint256;

    function supply(uint256 assets, address onBehalf) external {
        assets.toSharesDown(assets, 0, 0);
        onBehalf;
    }
    function withdraw(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function borrow(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function repay(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function supplyCollateral(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function withdrawCollateral(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function liquidate(address borrower, uint256 seizedAssets) external { borrower; seizedAssets; }
    function flashLoan(address token, uint256 assets) external { token; assets; }
}
