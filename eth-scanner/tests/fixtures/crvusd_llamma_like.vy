# @version 0.3.10
"""
LLAMMA-shaped crvUSD AMM. exchange already tags curve-pool.
Sourcify still misses live impls — pin the shape. Fixture only.
"""

@external
def exchange(i: uint256, j: uint256, in_amount: uint256, min_amount: uint256) -> uint256[2]:
    return [in_amount, min_amount]


@external
def exchange_dy(i: uint256, j: uint256, out_amount: uint256, max_amount: uint256) -> uint256[2]:
    return [out_amount, max_amount]


@external
def deposit_range(user: address, amount: uint256, n1: int256, n2: int256):
    pass


@external
def withdraw(user: address, frac: uint256) -> uint256[2]:
    return [frac, frac]
