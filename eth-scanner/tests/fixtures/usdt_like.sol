// SPDX-License-Identifier: MIT
pragma solidity ^0.4.18;

/// Tether-shaped ERC20 (Solidity 0.4 `constant` getter). Fixture only.
contract TetherToken {
    uint public _totalSupply;
    mapping(address => uint) public balances;

    function totalSupply() public constant returns (uint) {
        return _totalSupply;
    }

    function transfer(address _to, uint _value) public returns (bool) {
        require(balances[msg.sender] >= _value);
        balances[msg.sender] -= _value;
        balances[_to] += _value;
        return true;
    }

    function issue(uint amount) public {
        _totalSupply += amount;
        balances[msg.sender] += amount;
    }
}
