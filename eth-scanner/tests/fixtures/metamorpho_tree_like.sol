// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sourcify / standard-json leak: MetaMorpho trees ship sibling Morpho.sol.
/// `function borrow` on Morpho must not classify MetaMorpho as lending.
/// Fixture only — not a finding.

contract Morpho {
    function supply(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function withdraw(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function borrow(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function repay(uint256 assets, address onBehalf) external { assets; onBehalf; }
    function liquidate(address borrower, uint256 seized) external { borrower; seized; }
}

contract MetaMorpho {
    string public name = "Steakhouse USDC";
    string public symbol = "steakUSDC";
    mapping(address => uint256) public balanceOf;
    Morpho public morpho;

    function totalAssets() public view returns (uint256) { return 1; }
    function convertToShares(uint256 assets) public view returns (uint256) { return assets; }
    function convertToAssets(uint256 shares) public view returns (uint256) { return shares; }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        balanceOf[receiver] += assets;
        return assets;
    }
    function mint(uint256 shares, address receiver) external returns (uint256) {
        balanceOf[receiver] += shares;
        return shares;
    }
    function withdraw(uint256 assets, address receiver) external returns (uint256) {
        balanceOf[msg.sender] -= assets;
        receiver;
        return assets;
    }
    function redeem(uint256 shares, address receiver) external returns (uint256) {
        balanceOf[msg.sender] -= shares;
        receiver;
        return shares;
    }
    function reallocate() external { morpho.borrow(0, address(this)); }
}
