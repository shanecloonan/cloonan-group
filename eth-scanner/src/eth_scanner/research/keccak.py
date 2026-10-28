"""Keccak-256 (Ethereum), not NIST SHA3-256.

Used only to derive 4-byte function selectors. No keys, no network.
"""

from __future__ import annotations

_ROUNDS = 24
_RC = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)
_ROT = (
    0, 1, 62, 28, 27,
    36, 44, 6, 55, 20,
    3, 10, 43, 25, 39,
    41, 45, 15, 21, 8,
    18, 2, 61, 56, 14,
)
_MASK = 0xFFFFFFFFFFFFFFFF


def _rotl64(x: int, n: int) -> int:
    n %= 64
    return ((x << n) | (x >> (64 - n))) & _MASK


def _keccak_f(st: list[int]) -> None:
    for rnd in range(_ROUNDS):
        c = [st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20] for x in range(5)]
        d = [c[(x + 4) % 5] ^ _rotl64(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                st[x + 5 * y] ^= d[x]
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                idx = x + 5 * y
                nx, ny = y, (2 * x + 3 * y) % 5
                b[nx + 5 * ny] = _rotl64(st[idx], _ROT[idx])
        for x in range(5):
            for y in range(5):
                st[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y])
                st[x + 5 * y] &= _MASK
        st[0] ^= _RC[rnd]


def keccak256(data: bytes) -> bytes:
    """Return the 32-byte Keccak-256 digest."""
    rate = 136
    st = [0] * 25
    buf = bytearray(data) + bytearray([0x01])
    pad = rate - (len(buf) % rate)
    buf.extend(b"\x00" * (pad - 1))
    buf.append(0x80)
    for off in range(0, len(buf), rate):
        block = buf[off:off + rate]
        for i in range(rate // 8):
            st[i] ^= int.from_bytes(block[i * 8:(i + 1) * 8], "little")
        _keccak_f(st)
    out = bytearray()
    for i in range(4):
        out.extend(st[i].to_bytes(8, "little"))
    return bytes(out)


def selector4(signature: str) -> str:
    """4-byte Solidity selector as 0x-prefixed hex."""
    digest = keccak256(signature.encode("ascii"))
    return "0x" + digest[:4].hex()
