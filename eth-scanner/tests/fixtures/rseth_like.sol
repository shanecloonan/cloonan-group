// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Live Kelp rsETH token (`0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7`).
/// Impl `RSETH` at `0x7159…7783` — mint/burnFrom + recoverFrozenFunds.
/// LRTDepositPool holds LSTs. This address is a share token, not a venue.
/// Fixture only — not a finding.
contract RSETH {
    string public name = "rsETH";
    string public symbol = "rsETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public custodyAddress;
    mapping(address => uint256) public transfersBlockedUntil;

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

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
    function burnFrom(address account, uint256 amount) external {
        balanceOf[account] -= amount;
    }
    function recoverFrozenFunds(address from) external {
        uint256 amt = balanceOf[from];
        balanceOf[from] = 0;
        balanceOf[custodyAddress] += amt;
    }
    function setCustodyAddress(address next) external { custodyAddress = next; }
    function pause() external {}
    function unpause() external {}
}
