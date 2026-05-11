//! MFBN-1 canonical binary encoding.
//!
//! Mirrors `lib/network/codec.ts`. Big-endian, length-prefixed,
//! deterministic. Variable-length integers use LEB128 (7-bit groups,
//! continuation bit on the MSB).
//!
//! These encodings define **chain identity** — two different implementations
//! that disagree on a single byte produce different transaction or block IDs
//! and therefore fork the chain. Treat any change here as consensus-critical.

use curve25519_dalek::edwards::{CompressedEdwardsY, EdwardsPoint};
use curve25519_dalek::scalar::Scalar;

use crate::{CryptoError, Result};

/// Streaming writer for canonical binary encoding.
///
/// All append methods are chainable.
#[derive(Debug, Default, Clone)]
pub struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    /// Create an empty writer.
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// Create a writer with capacity pre-allocated.
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            buf: Vec::with_capacity(cap),
        }
    }

    /// Consume the writer and return the encoded bytes.
    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    /// Borrow the encoded bytes so far.
    pub fn bytes(&self) -> &[u8] {
        &self.buf
    }

    /// Append a raw byte slice (no length prefix).
    pub fn push(&mut self, b: &[u8]) -> &mut Self {
        self.buf.extend_from_slice(b);
        self
    }

    /// Append a single byte.
    pub fn u8(&mut self, v: u8) -> &mut Self {
        self.buf.push(v);
        self
    }

    /// Append a big-endian u32.
    pub fn u32(&mut self, v: u32) -> &mut Self {
        self.buf.extend_from_slice(&v.to_be_bytes());
        self
    }

    /// Append a big-endian u64.
    pub fn u64(&mut self, v: u64) -> &mut Self {
        self.buf.extend_from_slice(&v.to_be_bytes());
        self
    }

    /// Append a LEB128 varint.
    pub fn varint(&mut self, v: u64) -> &mut Self {
        let mut n = v;
        while n >= 0x80 {
            self.buf.push(((n as u8) & 0x7f) | 0x80);
            n >>= 7;
        }
        self.buf.push(n as u8);
        self
    }

    /// Append a length-prefixed byte slice (varint length + bytes).
    pub fn blob(&mut self, b: &[u8]) -> &mut Self {
        self.varint(b.len() as u64);
        self.buf.extend_from_slice(b);
        self
    }

    /// Append a 32-byte little-endian scalar.
    pub fn scalar(&mut self, s: &Scalar) -> &mut Self {
        self.buf.extend_from_slice(s.as_bytes());
        self
    }

    /// Append a 32-byte compressed Edwards point.
    pub fn point(&mut self, p: &EdwardsPoint) -> &mut Self {
        self.buf.extend_from_slice(p.compress().as_bytes());
        self
    }

    /// Append a varint length followed by `n` scalars.
    pub fn scalars(&mut self, ss: &[Scalar]) -> &mut Self {
        self.varint(ss.len() as u64);
        for s in ss {
            self.scalar(s);
        }
        self
    }

    /// Append a varint length followed by `n` points.
    pub fn points(&mut self, ps: &[EdwardsPoint]) -> &mut Self {
        self.varint(ps.len() as u64);
        for p in ps {
            self.point(p);
        }
        self
    }
}

/// Streaming reader for canonical binary encoding.
#[derive(Debug, Clone)]
pub struct Reader<'a> {
    buf: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    /// Create a reader over the given byte slice.
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, offset: 0 }
    }

    /// `true` when no bytes remain.
    pub fn end(&self) -> bool {
        self.offset >= self.buf.len()
    }

    /// Number of bytes still unread.
    pub fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.offset)
    }

    /// Read exactly `n` bytes; advance the offset.
    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.offset + n > self.buf.len() {
            return Err(CryptoError::ShortBuffer {
                needed: (self.offset + n) - self.buf.len(),
            });
        }
        let out = &self.buf[self.offset..self.offset + n];
        self.offset += n;
        Ok(out)
    }

    /// Read a single byte.
    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }

    /// Read a big-endian u32.
    pub fn u32(&mut self) -> Result<u32> {
        let b = self.bytes(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// Read a big-endian u64.
    pub fn u64(&mut self) -> Result<u64> {
        let b = self.bytes(8)?;
        Ok(u64::from_be_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    /// Read a LEB128 varint. Capped at 70 bits to match the TS reader.
    pub fn varint(&mut self) -> Result<u64> {
        let mut result: u64 = 0;
        let mut shift: u32 = 0;
        loop {
            if shift > 63 {
                return Err(CryptoError::VarintTooLong);
            }
            let b = self.u8()?;
            result |= u64::from(b & 0x7f) << shift;
            if (b & 0x80) == 0 {
                return Ok(result);
            }
            shift += 7;
        }
    }

    /// Read a varint length and then that many bytes.
    pub fn blob(&mut self) -> Result<&'a [u8]> {
        let n = self.varint()? as usize;
        self.bytes(n)
    }

    /// Read a 32-byte little-endian scalar, reduced mod ℓ.
    pub fn scalar(&mut self) -> Result<Scalar> {
        let b = self.bytes(32)?;
        let mut arr = [0u8; 32];
        arr.copy_from_slice(b);
        Ok(Scalar::from_bytes_mod_order(arr))
    }

    /// Read a 32-byte compressed Edwards point.
    pub fn point(&mut self) -> Result<EdwardsPoint> {
        let b = self.bytes(32)?;
        let mut arr = [0u8; 32];
        arr.copy_from_slice(b);
        CompressedEdwardsY(arr)
            .decompress()
            .ok_or(CryptoError::InvalidPoint)
    }

    /// Read a varint length and then that many scalars.
    pub fn scalars(&mut self) -> Result<Vec<Scalar>> {
        let n = self.varint()? as usize;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            out.push(self.scalar()?);
        }
        Ok(out)
    }

    /// Read a varint length and then that many points.
    pub fn points(&mut self) -> Result<Vec<EdwardsPoint>> {
        let n = self.varint()? as usize;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            out.push(self.point()?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_round_trip() {
        let cases: &[u64] = &[0, 1, 127, 128, 16383, 16384, 1 << 20, u64::MAX >> 1];
        for &v in cases {
            let mut w = Writer::new();
            w.varint(v);
            let mut r = Reader::new(w.bytes());
            let decoded = r.varint().expect("varint decode");
            assert_eq!(decoded, v);
            assert!(r.end(), "trailing bytes for {v}");
        }
    }

    #[test]
    fn blob_round_trip() {
        let payload: &[u8] = b"hello mfn world!";
        let mut w = Writer::new();
        w.blob(payload);
        let mut r = Reader::new(w.bytes());
        let out = r.blob().expect("blob");
        assert_eq!(out, payload);
        assert!(r.end());
    }

    #[test]
    fn fixed_width_round_trip() {
        let mut w = Writer::new();
        w.u8(0x42)
            .u32(0xdead_beef)
            .u64(0x1122_3344_5566_7788);
        let mut r = Reader::new(w.bytes());
        assert_eq!(r.u8().unwrap(), 0x42);
        assert_eq!(r.u32().unwrap(), 0xdead_beef);
        assert_eq!(r.u64().unwrap(), 0x1122_3344_5566_7788);
        assert!(r.end());
    }

    #[test]
    fn short_buffer_errors() {
        let mut r = Reader::new(&[0x01, 0x02]);
        assert!(matches!(r.bytes(8), Err(CryptoError::ShortBuffer { .. })));
    }
}
