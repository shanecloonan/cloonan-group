// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Folio {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Reserve Folio impl (`0xb6b3…E0A6`). ERC-4626 DTF. Pin.
/// Fixture only — not a finding.
contract Folio {
    string public name = "Folio";
    string public symbol = "DTF";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        from;
        return true;
    }

    function totalAssets() public view returns (uint256) { return 1; }
    function convertToShares(uint256 assets) public view returns (uint256) { return assets; }
    function convertToAssets(uint256 shares) public view returns (uint256) { return shares; }
    function previewDeposit(uint256 assets) public view returns (uint256) { return assets; }
    function previewRedeem(uint256 shares) public view returns (uint256) { return shares; }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        balanceOf[receiver] += assets;
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        balanceOf[owner] -= shares;
        receiver;
        return shares;
    }

    function startRebalance() external {}
    function addToBasket(address asset, uint256 amount) external {
        IERC20Folio(asset).transferFrom(msg.sender, address(this), amount);
    }
}
