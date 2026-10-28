// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Y {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Yearn V2-shaped vault (share token + pricePerShare, no ERC4626 name). Hybrid — stay vault.
/// Fixture only — not a finding.
contract YearnVault {
    string public name = "yvUSDC";
    string public symbol = "yvUSDC";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20Y public token;

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

    function pricePerShare() public view returns (uint256) {
        return 1e18;
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256 shares) external returns (uint256) {
        balanceOf[msg.sender] -= shares;
        token.transfer(msg.sender, shares);
        return shares;
    }
}
