//! Pedersen commitments.
//!
//! `C(v, r) = r·G + v·H` where:
//!
//! - `r` is a uniformly random scalar (the *blinding factor*),
//! - `v` is the value being committed,
//! - `G` is the ed25519 base point,
//! - `H` is the independent generator with no known discrete-log to `G`
//!   (we derive it as `hash_to_point(G_compressed)` so nobody knows `log_G H`).
//!
//! Properties:
//!
//! - **Perfectly hiding** — given `C`, every `(v, r)` pair is equally likely.
//! - **Computationally binding** — opening to a different `(v', r')` requires
//!   solving the discrete-log problem.
//! - **Additively homomorphic** —
//!   `C(v₁, r₁) + C(v₂, r₂) = C(v₁ + v₂, r₁ + r₂)` allows balance proofs
//!   without revealing any individual amount. This is the foundation of
//!   RingCT-style confidential amounts.
//!
//! Mirrors `pedersenCommit`/`pedersenVerify`/`pedersenSum`/`pedersenBalance`
//! in `lib/network/primitives.ts`.

use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;
use zeroize::Zeroize;

use crate::point::{generator_g, generator_h};
use crate::scalar::random_scalar;

/// An opened Pedersen commitment: the point plus the secrets that produced it.
///
/// The `value` and `blinding` scalars are zeroized on drop because they
/// constitute the opening — leaking either breaks hiding.
#[derive(Debug, Clone)]
pub struct PedersenCommitment {
    /// The commitment point `C = r·G + v·H`.
    pub c: EdwardsPoint,
    /// The committed value `v`.
    pub value: Scalar,
    /// The blinding factor `r`.
    pub blinding: Scalar,
}

impl Drop for PedersenCommitment {
    fn drop(&mut self) {
        self.value.zeroize();
        self.blinding.zeroize();
    }
}

/// Create a Pedersen commitment.
///
/// If `blinding` is `None`, a fresh uniform random scalar is drawn from the
/// OS CSPRNG.
pub fn pedersen_commit(value: Scalar, blinding: Option<Scalar>) -> PedersenCommitment {
    let r = blinding.unwrap_or_else(random_scalar);
    let c = (generator_g() * r) + (generator_h() * value);
    PedersenCommitment {
        c,
        value,
        blinding: r,
    }
}

/// Check that `c` opens to `(value, blinding)`.
pub fn pedersen_verify(c: &PedersenCommitment) -> bool {
    let expected = (generator_g() * c.blinding) + (generator_h() * c.value);
    expected == c.c
}

/// Sum a slice of commitments: `Σ C_i = (Σ r_i)·G + (Σ v_i)·H`.
///
/// Note that the resulting `PedersenCommitment` contains the *aggregate*
/// secrets — only meaningful when the caller actually knows all the
/// individual `(v_i, r_i)`. Most callers use this to compute the LHS or RHS
/// of a balance equation and then compare the points only.
pub fn pedersen_sum(commits: &[PedersenCommitment]) -> PedersenCommitment {
    let mut total_c = EdwardsPoint::identity();
    let mut total_v = Scalar::ZERO;
    let mut total_r = Scalar::ZERO;
    for ci in commits {
        total_c += ci.c;
        total_v += ci.value;
        total_r += ci.blinding;
    }
    PedersenCommitment {
        c: total_c,
        value: total_v,
        blinding: total_r,
    }
}

/// Verify that the sum of input commitments equals the sum of output
/// commitments. Used in RingCT to prove no value was created or destroyed
/// without revealing any individual amount.
pub fn pedersen_balance(
    inputs: &[PedersenCommitment],
    outputs: &[PedersenCommitment],
) -> bool {
    let sum_in = pedersen_sum(inputs).c;
    let sum_out = pedersen_sum(outputs).c;
    sum_in == sum_out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: u64) -> Scalar {
        Scalar::from(v)
    }

    #[test]
    fn open_verify() {
        let c = pedersen_commit(s(100), None);
        assert!(pedersen_verify(&c));
    }

    #[test]
    fn tampered_value_fails() {
        let mut c = pedersen_commit(s(100), None);
        c.value += Scalar::ONE;
        assert!(!pedersen_verify(&c));
    }

    #[test]
    fn tampered_blinding_fails() {
        let mut c = pedersen_commit(s(100), None);
        c.blinding += Scalar::ONE;
        assert!(!pedersen_verify(&c));
    }

    #[test]
    fn additive_homomorphism() {
        let a = pedersen_commit(s(3), None);
        let b = pedersen_commit(s(5), None);
        let sum = pedersen_sum(&[a.clone(), b.clone()]);
        // The sum should open to (3+5, r_a + r_b).
        assert_eq!(sum.value, s(8));
        assert_eq!(sum.blinding, a.blinding + b.blinding);
        assert!(pedersen_verify(&sum));
        // And it equals direct commitment with those secrets.
        let direct = pedersen_commit(s(8), Some(a.blinding + b.blinding));
        assert_eq!(sum.c, direct.c);
    }

    #[test]
    fn balance_with_matched_inputs_and_outputs() {
        // Inputs: 7 + 3 = 10. Outputs: 4 + 6 = 10.
        // We MUST also balance the blindings (Σ r_in = Σ r_out) for the
        // commitment points to agree, since the points carry both sums.
        let r_in_a = crate::scalar::random_scalar();
        let r_in_b = crate::scalar::random_scalar();
        let r_out_a = crate::scalar::random_scalar();
        // Forced r_out_b so Σ blindings balance:
        let r_out_b = r_in_a + r_in_b - r_out_a;

        let in_a = pedersen_commit(s(7), Some(r_in_a));
        let in_b = pedersen_commit(s(3), Some(r_in_b));
        let out_a = pedersen_commit(s(4), Some(r_out_a));
        let out_b = pedersen_commit(s(6), Some(r_out_b));

        assert!(pedersen_balance(&[in_a, in_b], &[out_a, out_b]));
    }

    #[test]
    fn balance_rejects_mismatch() {
        let in_a = pedersen_commit(s(7), None);
        let out_a = pedersen_commit(s(8), None);
        assert!(!pedersen_balance(&[in_a], &[out_a]));
    }

    #[test]
    fn hiding_two_distinct_blindings_give_distinct_commitments() {
        // With overwhelming probability, two commitments to the same value
        // under different blindings produce different points.
        let v = s(100);
        let c1 = pedersen_commit(v, None);
        let c2 = pedersen_commit(v, None);
        assert_ne!(c1.c, c2.c);
        // But both verify.
        assert!(pedersen_verify(&c1));
        assert!(pedersen_verify(&c2));
    }
}
