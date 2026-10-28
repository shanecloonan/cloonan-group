// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Comet {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Compound III Comet shape (live cUSDCv3 `0xc3d6…cdc3`). Lending, not generic custody.
/// Fixture only — not a finding.
contract Comet {
    string public name = "Compound USDC";
    string public symbol = "cUSDCv3";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20Comet public baseToken;

    function transfer(address to, uint256 value) public returns (bool) { balanceOf[to] += value; return true; }
    function approve(address spender, uint256 value) public returns (bool) { allowance[msg.sender][spender] = value; return true; }
    function transferFrom(address from, address to, uint256 value) public returns (bool) { from; balanceOf[to] += value; return true; }

    function supply(address asset, uint256 amount) external {
        IERC20Comet(asset).transferFrom(msg.sender, address(this), amount);
    }
    function withdraw(address asset, uint256 amount) external {
        IERC20Comet(asset).transfer(msg.sender, amount);
    }
    function absorb(address absorber, address[] calldata accounts) external {
        absorber;
        accounts;
    }
    function buyCollateral(address asset, uint256 minAmount, uint256 baseAmount, address recipient) external {
        asset;
        minAmount;
        baseAmount;
        recipient;
    }
    function borrowBalanceOf(address account) public view returns (uint256) { account; return 0; }
    function accrueAccount(address account) external { account; }
    function approveThis(address manager, address asset, uint256 amount) external {
        manager;
        asset;
        amount;
    }
}
