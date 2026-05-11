//! RingCT-style encrypted amount + blinding factor.
//!
//! Once a recipient detects an output is theirs (via [`crate::stealth`]),
//! they still need the *opening* of the Pedersen commitment
//! `C = r·G + v·H` — i.e. the pair `(value, blinding)`. We transmit both,
//! XOR-encrypted under masks derived from the sender-recipient shared secret
//! and the output index:
//!
//! ```text
//!   bytes  0.. 7  =  value     XOR  H_s(shared || i || "v")[0..8]
//!   bytes  8..39  =  blinding  XOR  H_s(shared || i || "b")          (32 bytes)
//! ```
//!
//! The masks are derived via the protocol's domain-separated
//! [`crate::hash::dhash`] using the
//! [`AMT_MASK_V`](crate::domain::AMT_MASK_V) and
//! [`AMT_MASK_B`](crate::domain::AMT_MASK_B) tags. Because the mask is
//! information-theoretically uniform in the attacker's view, the encryption
//! is a one-time-pad.
//!
//! Mirrors `encryptOutputAmount` / `decryptOutputAmount` in
//! `lib/network/primitives.ts`.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;

use crate::codec::Writer;
use crate::domain::{AMT_MASK_B, AMT_MASK_V};
use crate::hash::dhash;
use crate::{CryptoError, Result};

/// Encoded length of an encrypted-amount blob: 8 (value) + 32 (blinding).
pub const ENC_AMOUNT_BYTES: usize = 8 + 32;

fn mask_v(shared: &EdwardsPoint, output_index: u32) -> [u8; 8] {
    let mut w = Writer::new();
    w.push(&shared.compress().to_bytes());
    w.u32(output_index);
    let full = dhash(AMT_MASK_V, &[w.bytes()]);
    let mut out = [0u8; 8];
    out.copy_from_slice(&full[..8]);
    out
}

fn mask_b(shared: &EdwardsPoint, output_index: u32) -> [u8; 32] {
    let mut w = Writer::new();
    w.push(&shared.compress().to_bytes());
    w.u32(output_index);
    dhash(AMT_MASK_B, &[w.bytes()])
}

fn xor_into(dst: &mut [u8], src: &[u8]) {
    for (d, s) in dst.iter_mut().zip(src.iter()) {
        *d ^= *s;
    }
}

fn u64_le(v: u64) -> [u8; 8] {
    v.to_le_bytes()
}

fn scalar_le(s: &Scalar) -> [u8; 32] {
    s.to_bytes()
}

/// Sender: encrypt `(value, blinding)` for output `output_index`,
/// using `tx_priv` and the recipient's view public key to derive the
/// shared secret `r·A`.
pub fn encrypt_output_amount(
    tx_priv: Scalar,
    recipient_view_pub: &EdwardsPoint,
    output_index: u32,
    value: u64,
    blinding: &Scalar,
) -> [u8; ENC_AMOUNT_BYTES] {
    let shared = recipient_view_pub * tx_priv;
    let mut out = [0u8; ENC_AMOUNT_BYTES];
    // value half (8 bytes, little-endian)
    let mut v = u64_le(value);
    xor_into(&mut v, &mask_v(&shared, output_index));
    out[..8].copy_from_slice(&v);
    // blinding half (32 bytes, little-endian)
    let mut b = scalar_le(blinding);
    xor_into(&mut b, &mask_b(&shared, output_index));
    out[8..].copy_from_slice(&b);
    out
}

/// Decrypted opening returned by [`decrypt_output_amount`].
#[derive(Debug, Clone, Copy)]
pub struct DecryptedAmount {
    /// The committed value `v`.
    pub value: u64,
    /// The blinding factor `r` (interpreted mod ℓ).
    pub blinding: Scalar,
}

/// Recipient: decrypt `(value, blinding)` for output `output_index`,
/// using `view_priv` and the transaction public key to derive the shared
/// secret `a·R`.
pub fn decrypt_output_amount(
    r_point: &EdwardsPoint,
    output_index: u32,
    view_priv: Scalar,
    enc: &[u8],
) -> Result<DecryptedAmount> {
    if enc.len() != ENC_AMOUNT_BYTES {
        return Err(CryptoError::InvalidLength {
            expected: ENC_AMOUNT_BYTES,
            got: enc.len(),
        });
    }
    let shared = r_point * view_priv;
    let mut v = [0u8; 8];
    v.copy_from_slice(&enc[..8]);
    xor_into(&mut v, &mask_v(&shared, output_index));
    let value = u64::from_le_bytes(v);

    let mut b = [0u8; 32];
    b.copy_from_slice(&enc[8..]);
    xor_into(&mut b, &mask_b(&shared, output_index));
    let blinding = Scalar::from_bytes_mod_order(b);

    Ok(DecryptedAmount { value, blinding })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::generator_g;
    use crate::scalar::random_scalar;
    use crate::stealth::stealth_gen;

    #[test]
    fn encrypt_decrypt_round_trip() {
        let alice = stealth_gen();
        let tx_priv = random_scalar();
        let r_point = generator_g() * tx_priv;

        for (value, idx) in [(0u64, 0u32), (1, 1), (42, 2), (u64::MAX, 3)] {
            let blinding = random_scalar();
            let enc = encrypt_output_amount(tx_priv, &alice.view_pub, idx, value, &blinding);
            let dec = decrypt_output_amount(&r_point, idx, alice.view_priv, &enc).unwrap();
            assert_eq!(dec.value, value, "value mismatch");
            assert_eq!(dec.blinding, blinding, "blinding mismatch");
        }
    }

    #[test]
    fn wrong_view_key_decrypts_garbage() {
        let alice = stealth_gen();
        let bob = stealth_gen();
        let tx_priv = random_scalar();
        let r_point = generator_g() * tx_priv;
        let blinding = random_scalar();
        let enc = encrypt_output_amount(tx_priv, &alice.view_pub, 0, 42, &blinding);
        // Bob's view key produces a different shared secret ⇒ different mask
        // ⇒ the decrypted value almost-surely differs from 42.
        let dec = decrypt_output_amount(&r_point, 0, bob.view_priv, &enc).unwrap();
        // Probability of accidental match ≈ 2⁻⁶⁴.
        assert_ne!(dec.value, 42);
    }

    #[test]
    fn wrong_index_decrypts_garbage() {
        let alice = stealth_gen();
        let tx_priv = random_scalar();
        let r_point = generator_g() * tx_priv;
        let enc = encrypt_output_amount(tx_priv, &alice.view_pub, 0, 42, &random_scalar());
        let dec = decrypt_output_amount(&r_point, 1, alice.view_priv, &enc).unwrap();
        assert_ne!(dec.value, 42);
    }

    #[test]
    fn wrong_length_errors() {
        let alice = stealth_gen();
        let r_point = generator_g();
        assert!(matches!(
            decrypt_output_amount(&r_point, 0, alice.view_priv, &[0u8; 1]),
            Err(CryptoError::InvalidLength { .. })
        ));
    }
}
