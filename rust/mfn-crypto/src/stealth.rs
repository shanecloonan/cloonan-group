//! CryptoNote-style dual-key stealth addresses (basic + indexed).
//!
//! Each wallet has two private scalars and the corresponding public points:
//!
//! - `a` — *view* private key,  `A = a·G`  (view public key).
//! - `b` — *spend* private key, `B = b·G`  (spend public key).
//!
//! A sender constructs a one-time output address for the recipient `(A, B)`:
//!
//! - draw fresh `r ←$ ℤ_ℓ`,
//! - publish `R = r·G` (the *transaction public key*),
//! - publish `P = H_s(r·A)·G + B` (the *one-time output address*).
//!
//! The recipient detects ownership by recomputing
//! `P' = H_s(a·R)·G + B` and comparing.
//!
//! The recipient spends by deriving `x = H_s(a·R) + b mod ℓ`, with `x·G = P`.
//!
//! ## Indexed variant
//!
//! When a single transaction has multiple outputs sharing one `R`, each
//! output's stealth derivation is salted with its big-endian u32 index `i`
//! so distinct outputs cannot collide:
//!
//! ```text
//! P_i = H_s(r·A || i_be4)·G + B
//! x_i = H_s(a·R || i_be4) + b mod ℓ
//! ```
//!
//! Mirrors the basic and indexed stealth helpers in
//! `lib/network/primitives.ts`.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use zeroize::Zeroize;

use crate::hash::hash_to_scalar;
use crate::point::generator_g;
use crate::scalar::random_scalar;

/// A receiving wallet's dual keypair.
///
/// Both private keys are zeroized on drop.
#[derive(Debug, Clone)]
pub struct StealthWallet {
    /// Private view key `a`.
    pub view_priv: Scalar,
    /// Public view key `A = a·G`.
    pub view_pub: EdwardsPoint,
    /// Private spend key `b`.
    pub spend_priv: Scalar,
    /// Public spend key `B = b·G`.
    pub spend_pub: EdwardsPoint,
}

impl Drop for StealthWallet {
    fn drop(&mut self) {
        self.view_priv.zeroize();
        self.spend_priv.zeroize();
    }
}

/// A single stealth output: `(R, P)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StealthOutput {
    /// Transaction public key `R = r·G`.
    pub r: EdwardsPoint,
    /// One-time output address `P = H_s(r·A)·G + B`.
    pub one_time_addr: EdwardsPoint,
}

/// Generate a fresh stealth wallet (view + spend keypairs).
pub fn stealth_gen() -> StealthWallet {
    let view_priv = random_scalar();
    let spend_priv = random_scalar();
    StealthWallet {
        view_priv,
        view_pub: generator_g() * view_priv,
        spend_priv,
        spend_pub: generator_g() * spend_priv,
    }
}

/// Public view of a receiving wallet (no secrets).
#[derive(Debug, Clone, Copy)]
pub struct StealthPubKeys {
    /// Recipient's public view key.
    pub view_pub: EdwardsPoint,
    /// Recipient's public spend key.
    pub spend_pub: EdwardsPoint,
}

impl From<&StealthWallet> for StealthPubKeys {
    fn from(w: &StealthWallet) -> Self {
        Self {
            view_pub: w.view_pub,
            spend_pub: w.spend_pub,
        }
    }
}

/// Sender: construct a one-time address for the recipient.
pub fn stealth_send_to(recipient: &StealthPubKeys) -> StealthOutput {
    let r_scalar = random_scalar();
    let r_point = generator_g() * r_scalar;
    let shared = recipient.view_pub * r_scalar; // r·A
    let hs = hash_to_scalar(&[&shared.compress().to_bytes()]);
    let p = (generator_g() * hs) + recipient.spend_pub;
    StealthOutput {
        r: r_point,
        one_time_addr: p,
    }
}

/// Recipient: is this output ours? Detection only — does not derive the
/// spend key.
pub fn stealth_detect(output: &StealthOutput, wallet: &StealthWallet) -> bool {
    let shared = output.r * wallet.view_priv; // a·R
    let hs = hash_to_scalar(&[&shared.compress().to_bytes()]);
    let expected = (generator_g() * hs) + wallet.spend_pub;
    expected == output.one_time_addr
}

/// Recipient: derive the one-time *private* key `x` such that `x·G = P`.
///
/// Requires the spend private key — view-only wallets can detect but
/// cannot spend.
pub fn stealth_spend_key(output: &StealthOutput, wallet: &StealthWallet) -> Scalar {
    let shared = output.r * wallet.view_priv;
    let hs = hash_to_scalar(&[&shared.compress().to_bytes()]);
    hs + wallet.spend_priv
}

/* ----------------------------------------------------------------------- *
 *  Indexed stealth (multi-output tx)                                      *
 * ----------------------------------------------------------------------- */

fn indexed_shared_hash(shared: &EdwardsPoint, output_index: u32) -> Scalar {
    let bytes = shared.compress().to_bytes();
    let idx = output_index.to_be_bytes();
    hash_to_scalar(&[&bytes, &idx])
}

/// Sender: derive the indexed one-time address for output `output_index`,
/// given the transaction-level scalar `tx_priv` (where `R = tx_priv·G`).
pub fn indexed_stealth_address(
    tx_priv: Scalar,
    recipient: &StealthPubKeys,
    output_index: u32,
) -> EdwardsPoint {
    let shared = recipient.view_pub * tx_priv;
    let hs = indexed_shared_hash(&shared, output_index);
    (generator_g() * hs) + recipient.spend_pub
}

/// Recipient: does the indexed `one_time_addr` for output `output_index`
/// belong to them given the tx public key `r_point`?
pub fn indexed_stealth_detect(
    r_point: &EdwardsPoint,
    one_time_addr: &EdwardsPoint,
    output_index: u32,
    wallet: &StealthWallet,
) -> bool {
    let shared = r_point * wallet.view_priv;
    let hs = indexed_shared_hash(&shared, output_index);
    let expected = (generator_g() * hs) + wallet.spend_pub;
    expected == *one_time_addr
}

/// Recipient: derive the indexed one-time spend key.
pub fn indexed_stealth_spend_key(
    r_point: &EdwardsPoint,
    output_index: u32,
    wallet: &StealthWallet,
) -> Scalar {
    let shared = r_point * wallet.view_priv;
    let hs = indexed_shared_hash(&shared, output_index);
    hs + wallet.spend_priv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_detect_and_spend() {
        let alice = stealth_gen();
        let output = stealth_send_to(&(&alice).into());
        assert!(stealth_detect(&output, &alice));
        let x = stealth_spend_key(&output, &alice);
        // The derived spend key must satisfy x·G == P.
        assert_eq!(generator_g() * x, output.one_time_addr);
    }

    #[test]
    fn non_recipient_cannot_detect() {
        let alice = stealth_gen();
        let bob = stealth_gen();
        let output = stealth_send_to(&(&alice).into());
        assert!(!stealth_detect(&output, &bob));
    }

    #[test]
    fn unlinkable_outputs() {
        // Two independent sends to Alice should produce different one-time
        // addresses (unlinkability).
        let alice = stealth_gen();
        let o1 = stealth_send_to(&(&alice).into());
        let o2 = stealth_send_to(&(&alice).into());
        assert_ne!(o1.r, o2.r);
        assert_ne!(o1.one_time_addr, o2.one_time_addr);
        // Both are still detectable as Alice's.
        assert!(stealth_detect(&o1, &alice));
        assert!(stealth_detect(&o2, &alice));
    }

    #[test]
    fn indexed_outputs_distinct() {
        let alice = stealth_gen();
        let tx_priv = random_scalar();
        let r_point = generator_g() * tx_priv;

        let p0 = indexed_stealth_address(tx_priv, &(&alice).into(), 0);
        let p1 = indexed_stealth_address(tx_priv, &(&alice).into(), 1);
        let p2 = indexed_stealth_address(tx_priv, &(&alice).into(), 2);

        assert_ne!(p0, p1);
        assert_ne!(p1, p2);
        assert_ne!(p0, p2);

        // All three detect correctly at their own index.
        assert!(indexed_stealth_detect(&r_point, &p0, 0, &alice));
        assert!(indexed_stealth_detect(&r_point, &p1, 1, &alice));
        assert!(indexed_stealth_detect(&r_point, &p2, 2, &alice));

        // But a misaligned index does NOT match.
        assert!(!indexed_stealth_detect(&r_point, &p0, 1, &alice));
        assert!(!indexed_stealth_detect(&r_point, &p1, 0, &alice));

        // Spend keys round-trip through G.
        let x0 = indexed_stealth_spend_key(&r_point, 0, &alice);
        let x1 = indexed_stealth_spend_key(&r_point, 1, &alice);
        assert_eq!(generator_g() * x0, p0);
        assert_eq!(generator_g() * x1, p1);
    }
}
