// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20ThR {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// TreehouseRedemptionV3 (`0x62fb…dd90`). Queues tETH shares, then
/// redeems from the vault after the wait. Fixture only — not a finding.
contract TreehouseRedemptionV3 {
    address public TASSET;
    uint256 public totalRedeemingShares;
    uint256 public totalRedeemingAssets;

    function redeem(uint96 shares) external {
        IERC20ThR(TASSET).transferFrom(msg.sender, address(this), shares);
        totalRedeemingShares += shares;
    }

    function redeemWithNft(uint96 shares, address nft, uint256 tokenId) external {
        nft;
        tokenId;
        redeem(shares);
    }

    function finalizeRedeem(uint256 redeemIndex) external {
        redeemIndex;
        totalRedeemingShares -= 1;
    }
}
