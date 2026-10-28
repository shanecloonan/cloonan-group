// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Curve-style stableswap (LP token + add/remove liquidity). Hybrid — stay pool.
/// Fixture only — not a finding.
contract CurvePool {
    string public name = "Curve.fi DAI/USDC";
    string public symbol = "3CRV";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256[3] public balances;

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

    function add_liquidity(uint256[3] calldata amounts, uint256 min_mint) external {
        amounts;
        min_mint;
        balanceOf[msg.sender] += 1;
    }

    function remove_liquidity(uint256 amount, uint256[3] calldata min_amounts) external {
        balanceOf[msg.sender] -= amount;
        min_amounts;
    }

    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external {
        i;
        j;
        dx;
        min_dy;
    }
}
