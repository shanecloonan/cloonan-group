//! End-to-end integration tests across all primitives.
//!
//! These mirror the most important round-trip checks from
//! `scripts/smoke-network.ts` on the TS side: send → detect →
//! decrypt-amount → derive-spend-key → balance.

use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;
use curve25519_dalek::edwards::EdwardsPoint;

use mfn_crypto::{
    decrypt_output_amount, encrypt_output_amount, generator_g, indexed_stealth_address,
    indexed_stealth_detect, indexed_stealth_spend_key, pedersen_balance, pedersen_commit,
    pedersen_verify, schnorr_keygen, schnorr_sign, schnorr_verify, stealth_detect, stealth_gen,
    stealth_send_to,
};

#[test]
fn schnorr_round_trip_many() {
    for _ in 0..16 {
        let kp = schnorr_keygen();
        let msg = b"integration message";
        let sig = schnorr_sign(msg, &kp);
        assert!(schnorr_verify(msg, &sig, &kp.pub_key));
    }
}

#[test]
fn stealth_send_detect_spend() {
    let alice = stealth_gen();
    let out = stealth_send_to(&(&alice).into());
    assert!(stealth_detect(&out, &alice));
    let spend = mfn_crypto::stealth_spend_key(&out, &alice);
    // The spend key must reveal P.
    assert_eq!(generator_g() * spend, out.one_time_addr);
}

#[test]
fn full_confidential_payment_flow() {
    // Sender: knows tx_priv, recipient's (A, B), wants to send 100 units.
    // Recipient: knows (a, b). Eventually decrypts and spends.
    let alice = stealth_gen();
    let tx_priv = mfn_crypto::random_scalar();
    let r_point = generator_g() * tx_priv;
    let value: u64 = 100;
    let blinding = mfn_crypto::random_scalar();
    let idx: u32 = 0;

    // Sender constructs an indexed one-time address.
    let one_time = indexed_stealth_address(tx_priv, &(&alice).into(), idx);
    // Sender publishes the Pedersen commitment to (value, blinding).
    let c = pedersen_commit(Scalar::from(value), Some(blinding));
    // Sender encrypts (value, blinding) for the recipient.
    let enc = encrypt_output_amount(tx_priv, &alice.view_pub, idx, value, &blinding);

    // ── Recipient side ────────────────────────────────────────────
    // 1) Detect ownership.
    assert!(indexed_stealth_detect(&r_point, &one_time, idx, &alice));
    // 2) Decrypt the amount + blinding.
    let dec = decrypt_output_amount(&r_point, idx, alice.view_priv, &enc).unwrap();
    assert_eq!(dec.value, value);
    assert_eq!(dec.blinding, blinding);
    // 3) Verify the Pedersen commitment opens to the decrypted opening.
    let reopened = mfn_crypto::PedersenCommitment {
        c: c.c,
        value: Scalar::from(dec.value),
        blinding: dec.blinding,
    };
    assert!(pedersen_verify(&reopened));
    // 4) Derive the one-time spend key — only possible with `spend_priv`.
    let x = indexed_stealth_spend_key(&r_point, idx, &alice);
    assert_eq!(generator_g() * x, one_time);
}

#[test]
fn ringct_balance_two_in_two_out() {
    // Construct (7+3) → (4+6). Σ blindings must also match (mod ℓ) for
    // the commitment points to balance.
    let r_in_a = mfn_crypto::random_scalar();
    let r_in_b = mfn_crypto::random_scalar();
    let r_out_a = mfn_crypto::random_scalar();
    let r_out_b = r_in_a + r_in_b - r_out_a;

    let in_a = pedersen_commit(Scalar::from(7u64), Some(r_in_a));
    let in_b = pedersen_commit(Scalar::from(3u64), Some(r_in_b));
    let out_a = pedersen_commit(Scalar::from(4u64), Some(r_out_a));
    let out_b = pedersen_commit(Scalar::from(6u64), Some(r_out_b));

    assert!(pedersen_balance(&[in_a, in_b], &[out_a, out_b]));
}

#[test]
fn identity_point_is_neutral() {
    // Sanity that we're using the curve correctly.
    let p = generator_g() * Scalar::from(42u64);
    assert_eq!(p + EdwardsPoint::identity(), p);
    assert_eq!(p * Scalar::ZERO, EdwardsPoint::identity());
}
