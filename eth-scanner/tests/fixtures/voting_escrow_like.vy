# @version 0.2.4
# Curve VotingEscrow shape (live veCRV `0x5f3b…e2A2`, veFXS `0xc841…5b0`).
# Locked tokens sit here. Must be staking, not a token. Fixture only — not a finding.

token: public(address)
supply: public(uint256)

@external
def create_lock(_value: uint256, _unlock_time: uint256):
    pass

@external
def increase_amount(_value: uint256):
    pass

@external
def increase_unlock_time(_unlock_time: uint256):
    pass

@external
def withdraw():
    pass

@view
@external
def balanceOf(addr: address) -> uint256:
    return 0

@view
@external
def totalSupply() -> uint256:
    return 0
