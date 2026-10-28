// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20K {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Kelp LRTDepositPool — holds LSTs, mints rsETH. Venue, not the share token.
/// Fixture only — not a finding.
contract LRTDepositPool {
    mapping(address => uint256) public totalAssetDeposits;

    function depositAsset(address asset, uint256 amount) external {
        IERC20K(asset).transferFrom(msg.sender, address(this), amount);
        totalAssetDeposits[asset] += amount;
    }

    function getRsETHAmountToMint(address asset, uint256 amount) public view returns (uint256) {
        asset;
        return amount;
    }

    function getTotalAssetDeposits(address asset) public view returns (uint256) {
        return totalAssetDeposits[asset];
    }

    function transferAssetToNodeDelegator(uint256 ndcIndex, address asset, uint256 amount) external {
        ndcIndex;
        asset;
        amount;
    }
}
