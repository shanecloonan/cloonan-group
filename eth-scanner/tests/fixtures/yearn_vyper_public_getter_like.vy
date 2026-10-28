# @version 0.2.12
# Vyper `pricePerShare: public(uint256)` getter (not `def pricePerShare`).
# Must tag yearn-share-price, not share-accounting. Fixture only — not a finding.

token: public(address)
balanceOf: public(HashMap[address, uint256])
pricePerShare: public(uint256)

@external
def deposit(amount: uint256) -> uint256:
    self.balanceOf[msg.sender] += amount
    return amount

@external
def withdraw(shares: uint256) -> uint256:
    self.balanceOf[msg.sender] -= shares
    return shares
