// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20C {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Compound cToken-shaped market (ERC-20 + borrow/repay). Hybrid — stay lending.
/// Fixture only — not a finding.
contract CErc20 {
    string public name = "Compound USD Coin";
    string public symbol = "cUSDC";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20C public underlying;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        from;
        return true;
    }

    function exchangeRateStored() public view returns (uint256) {
        return 1e18;
    }

    function accrueInterest() public returns (uint256) {
        return 0;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), mintAmount);
        balanceOf[msg.sender] += mintAmount;
        return 0;
    }

    function redeem(uint256 redeemTokens) external returns (uint256) {
        balanceOf[msg.sender] -= redeemTokens;
        underlying.transfer(msg.sender, redeemTokens);
        return 0;
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        underlying.transfer(msg.sender, borrowAmount);
        return 0;
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), repayAmount);
        return 0;
    }
}
