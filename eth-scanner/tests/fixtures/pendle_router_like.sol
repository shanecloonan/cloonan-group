// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20P {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Live Pendle Router diamond facet ActionAddRemoveLiqV3 (`0x8888…F946` impl).
/// Pass-through — markets hold SY/PT. Fixture only — not a finding.
contract ActionAddRemoveLiqV3 {
    function addLiquidityDualTokenAndPt(address market, uint256 tokenIn, uint256 ptIn) external {
        IERC20P(market).transferFrom(msg.sender, market, tokenIn);
        ptIn;
    }
    function addLiquiditySinglePt(address market, uint256 netPtIn) external { market; netPtIn; }
    function addLiquiditySingleToken(address market, uint256 netTokenIn) external { market; netTokenIn; }
    function removeLiquiditySinglePt(address market, uint256 lpToRemove) external { market; lpToRemove; }
    function removeLiquidityDualTokenAndPt(address market, uint256 lpToRemove) external { market; lpToRemove; }
}
