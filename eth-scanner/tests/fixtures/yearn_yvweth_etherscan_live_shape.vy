# @version 0.2.12
# Live Yearn V2 yvWETH (`0xa258C4606Ca8206D8aA700cE2143D7db854D168c`).
# Etherscan ingest 2026-10-28: CompilerVersion=vyper:0.2.12,
# ContractName=Vyper_contract, Proxy=2,
# Implementation=0x671a912c10bba0cfa74cfc2d6fba9ba1ed9530b2 (same Vault.vy).
# Sourcify 404 on the proxy; impl Sourcify 200. Fixture only — not a finding.

from vyper.interfaces import ERC20

token: public(address)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])
totalSupply: public(uint256)
name: public(String[64])
symbol: public(String[32])
decimals: public(uint256)

@external
def transfer(_to: address, _value: uint256) -> bool:
    self.balanceOf[msg.sender] -= _value
    self.balanceOf[_to] += _value
    return True

@external
def approve(_spender: address, _value: uint256) -> bool:
    self.allowance[msg.sender][_spender] = _value
    return True

@external
def transferFrom(_from: address, _to: address, _value: uint256) -> bool:
    self.balanceOf[_from] -= _value
    self.balanceOf[_to] += _value
    return True

@external
def deposit(_amount: uint256 = MAX_UINT256, recipient: address = msg.sender) -> uint256:
    amt: uint256 = _amount
    ERC20(self.token).transferFrom(msg.sender, self, amt)
    self.balanceOf[recipient] += amt
    self.totalSupply += amt
    return amt

@external
def withdraw(_shares: uint256, recipient: address = msg.sender) -> uint256:
    self.balanceOf[msg.sender] -= _shares
    self.totalSupply -= _shares
    ERC20(self.token).transfer(recipient, _shares)
    return _shares

@view
@external
def pricePerShare() -> uint256:
    return 10 ** self.decimals

@view
@external
def totalAssets() -> uint256:
    return self.totalSupply
