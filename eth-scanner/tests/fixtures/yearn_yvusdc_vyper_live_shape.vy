# @version 0.2.12
# Live Yearn V2 yvUSDC (`0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE`).
# Sourcify miss; shape locked from public yearn-vaults Vault.vy v0.4.3.
# Etherscan ContractName is yVault — not aliased to Vault.
# Must tag yearn-share-price. Fixture only — not a finding.

from vyper.interfaces import ERC20

token: public(address)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])
totalSupply: public(uint256)
name: public(String[64])
symbol: public(String[32])
# Vyper public getter form (also seen on some vaults). Must still tag yearn-share-price.
# The live 0.4.3 vault exposes `def pricePerShare()` below; both are valid.

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
def deposit(amount: uint256) -> uint256:
    ERC20(self.token).transferFrom(msg.sender, self, amount)
    self.balanceOf[msg.sender] += amount
    self.totalSupply += amount
    return amount

@external
def withdraw(shares: uint256) -> uint256:
    self.balanceOf[msg.sender] -= shares
    self.totalSupply -= shares
    ERC20(self.token).transfer(msg.sender, shares)
    return shares

@view
@external
def pricePerShare() -> uint256:
    return 10 ** 18

@view
@external
def totalAssets() -> uint256:
    return self.totalSupply
