# @version 0.2.4
# Curve 3pool gauge shape (live `0xbFcF…952A`). LP tokens sit here.
# Must be staking/curve-gauge, not generic custody. Fixture only.

@external
def deposit(_value: uint256):
    pass

@external
def withdraw(_value: uint256):
    pass

@external
def set_approve_deposit(_addr: address, _can_deposit: bool):
    pass

@view
@external
def claimable_tokens(addr: address) -> uint256:
    return 0
