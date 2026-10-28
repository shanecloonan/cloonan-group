// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sourcify / standard-json leak: RSETH trees can ship sibling LRTDepositPool.
/// `depositAsset` on the pool must not flip the rsETH *token* to staking
/// when ContractName is RSETH. Fixture only — not a finding.

contract LRTDepositPool {
    mapping(address => uint256) public totalAssetDeposits;

    function depositAsset(address asset, uint256 amount) external {
        totalAssetDeposits[asset] += amount;
        asset;
        amount;
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

contract RSETH {
    string public name = "rsETH";
    string public symbol = "rsETH";
    mapping(address => uint256) public balanceOf;
    LRTDepositPool public pool;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        spender;
        value;
        return true;
    }
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function burnFrom(address account, uint256 amount) external { balanceOf[account] -= amount; }
}
