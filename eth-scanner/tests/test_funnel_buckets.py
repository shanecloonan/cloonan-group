"""Funnel bucket routing — especially manual-review on low / failed IR.

No network. No exploit fixtures. Heuristic leads only.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.funnel.s0_s7 import FunnelConfig, FunnelContext, Hypothesis, run_lane_a, run_lane_b
from eth_scanner.ir.normalize import normalize
from eth_scanner.lane_a.worker import run_one as lane_a_one
from eth_scanner.store.supabase import MemoryStore
from eth_scanner.types import FunctionIR, IRDocument, SourceArtifact, Target

ADDR = "0x" + "11" * 20


def _target(**kw) -> Target:
    base = dict(address=ADDR, has_code=True, tvl_usd=0.0)
    base.update(kw)
    return Target(**base)


def _art(conf="high", kind="source", content="pragma solidity ^0.8.20;\ncontract C {}") -> SourceArtifact:
    return SourceArtifact(
        kind=kind,  # type: ignore[arg-type]
        language="solidity",
        content=content,
        src_confidence=conf,  # type: ignore[arg-type]
        verified_match="exact" if conf == "high" else "none",
        tool="test",
    )


def _mover(name="withdraw", auth="PRESENT", exposed=True) -> FunctionIR:
    return FunctionIR(
        name=name,
        visibility="external" if exposed else "internal",
        line=10,
        file="Vault.sol",
        fund_signals=[".transfer("],
        auth_signals=["onlyOwner"] if auth == "PRESENT" else [],
        auth_heuristic=auth,
        is_value_mover=True,
        exposed=exposed,
    )


def _ir(conf="high", movers=None, lift_failed=False, src="high", weird=None, acct=None) -> IRDocument:
    return IRDocument(
        functions=list(movers or []),
        ir_confidence=conf,  # type: ignore[arg-type]
        src_confidence=src,  # type: ignore[arg-type]
        language="solidity",
        lift_failed=lift_failed,
        lift_tool="test",
        weird_signals=list(weird or []),
        accounting_hits=list(acct or []),
    )


class S0Intake(unittest.TestCase):
    def test_empty_eoa_dropped(self):
        r = run_lane_a(FunnelContext(target=_target(has_code=False), artifact=_art(), ir=_ir()))
        self.assertTrue(r.dropped)
        self.assertIsNone(r.bucket)
        self.assertIn("zero-code", r.drop_reason or "")

    def test_non_eth_dropped(self):
        t = _target()
        t.chain = "base"  # type: ignore[assignment]
        r = run_lane_a(FunnelContext(target=t, artifact=_art(), ir=_ir()))
        self.assertTrue(r.dropped)
        self.assertIn("non-ethereum", r.drop_reason or "")

    def test_duplicate_closed_no_dropped(self):
        r = run_lane_a(FunnelContext(
            target=_target(bytecode_hash="abc", prior_closed_no=True),
            artifact=_art(),
            ir=_ir(),
        ))
        self.assertTrue(r.dropped)

    def test_duplicate_needs_look_kept(self):
        r = run_lane_a(FunnelContext(
            target=_target(bytecode_hash="abc", prior_verdict="needs-look"),
            artifact=_art(),
            ir=_ir(movers=[_mover()]),
        ))
        self.assertFalse(r.dropped)


class ManualReviewOnWeakIR(unittest.TestCase):
    def test_low_ir_manual_review(self):
        r = run_lane_a(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("low", movers=[_mover()]),
        ))
        self.assertEqual(r.bucket, "manual-review")
        self.assertFalse(r.dropped)
        self.assertTrue(any(t.stage == "S2" and t.decision == "manual-review" for t in r.stage_trace))

    def test_failed_ir_manual_review(self):
        r = run_lane_a(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("med", lift_failed=True, movers=[_mover()]),
        ))
        self.assertEqual(r.bucket, "manual-review")

    def test_missing_ir_manual_review(self):
        r = run_lane_a(FunnelContext(target=_target(), artifact=_art("high"), ir=None))
        self.assertEqual(r.bucket, "manual-review")

    def test_low_src_manual_review_even_if_ir_med(self):
        r = run_lane_a(FunnelContext(
            target=_target(),
            artifact=_art("low", kind="decompile"),
            ir=_ir("med", movers=[_mover()], src="low"),
        ))
        self.assertEqual(r.bucket, "manual-review")

    def test_ambiguous_auth_manual_review(self):
        r = run_lane_a(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover(auth="AMBIGUOUS")]),
        ))
        self.assertEqual(r.bucket, "manual-review")

    def test_self_scoped_is_weak_not_manual_review(self):
        r = run_lane_a(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover(auth="SELF-SCOPED?")]),
        ))
        self.assertNotEqual(r.bucket, "manual-review")
        self.assertIn(r.bucket, {"lane-a-cool", "lane-b-queue"})

    def test_ingest_incomplete_empty_eoa_not_dropped(self):
        t = _target(has_code=False)
        t.ingest_incomplete = True
        t.ingest_incomplete_reason = "etherscan rate-limited"
        r = run_lane_a(FunnelContext(target=t, artifact=_art("low", kind="decompile", content=""), ir=None))
        self.assertFalse(r.dropped)
        self.assertEqual(r.bucket, "manual-review")


class LaneARouting(unittest.TestCase):
    def test_no_movers_high_ir_verified_human_no_candidate(self):
        r = run_lane_a(FunnelContext(target=_target(), artifact=_art("high"), ir=_ir("high", movers=[])))
        self.assertEqual(r.bucket, "human-no-candidate")

    def test_no_movers_med_ir_is_cool_not_a_close(self):
        r = run_lane_a(FunnelContext(target=_target(), artifact=_art("high"), ir=_ir("med", movers=[])))
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_strong_auth_high_ir_cool(self):
        r = run_lane_a(FunnelContext(
            target=_target(tvl_usd=0),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover(auth="PRESENT")]),
        ))
        self.assertEqual(r.bucket, "lane-a-cool")

    def test_missing_auth_high_ir_promotes_lane_b(self):
        r = run_lane_a(FunnelContext(
            target=_target(tvl_usd=0),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover(auth="MISSING"), _mover(name="sweep", auth="WEAK")]),
        ))
        self.assertEqual(r.bucket, "lane-b-queue")
        self.assertGreaterEqual(r.heat, 3)

    def test_high_tvl_promotes_even_if_gated(self):
        r = run_lane_a(FunnelContext(
            target=_target(tvl_usd=50_000),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover(auth="PRESENT")]),
        ))
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_weird_bridge_promotes(self):
        r = run_lane_a(FunnelContext(
            target=_target(tvl_usd=0),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover(auth="PRESENT")], weird=["bridge-mint-release"]),
        ))
        self.assertEqual(r.bucket, "lane-b-queue")

    def test_mixed_ambiguous_and_weak_does_not_force_manual_review(self):
        r = run_lane_a(FunnelContext(
            target=_target(tvl_usd=0),
            artifact=_art("high"),
            ir=_ir("high", movers=[
                _mover(name="borrow", auth="WEAK"),
                _mover(name="repay", auth="AMBIGUOUS"),
            ]),
        ))
        self.assertNotEqual(r.bucket, "manual-review")
        self.assertNotEqual(r.bucket, "human-yes-candidate")

    def test_lane_a_never_emits_human_yes(self):
        cases = [
            _ir("high", movers=[]),
            _ir("high", movers=[_mover(auth="PRESENT")]),
            _ir("high", movers=[_mover(auth="MISSING"), _mover(name="x", auth="WEAK")]),
            _ir("low", movers=[_mover()]),
        ]
        for ir in cases:
            r = run_lane_a(FunnelContext(target=_target(tvl_usd=9_999_999), artifact=_art("high"), ir=ir))
            self.assertNotEqual(r.bucket, "human-yes-candidate")


class LaneBRouting(unittest.TestCase):
    def test_broken_routes_human_yes_candidate(self):
        r = run_lane_b(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover()]),
            hypotheses=[Hypothesis(invariant="I1", text="injected", status="BROKEN", score=12, locus="Vault.sol:withdraw:10")],
        ))
        self.assertEqual(r.bucket, "human-yes-candidate")

    def test_all_holds_high_conf_human_no(self):
        r = run_lane_b(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover()]),
            hypotheses=[Hypothesis(invariant="I1", text="ok", status="HOLDS", score=4)],
        ))
        self.assertEqual(r.bucket, "human-no-candidate")

    def test_open_ge_8_manual_review(self):
        r = run_lane_b(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("high", movers=[_mover()]),
            hypotheses=[Hypothesis(invariant="I1", text="open", status="OPEN", score=9)],
        ))
        self.assertEqual(r.bucket, "manual-review")

    def test_low_ir_stays_manual_review(self):
        r = run_lane_b(FunnelContext(
            target=_target(),
            artifact=_art("high"),
            ir=_ir("low", movers=[_mover()]),
            hypotheses=[Hypothesis(invariant="I1", text="x", status="HOLDS", score=2)],
        ))
        self.assertEqual(r.bucket, "manual-review")


class NormalizeAndLaneADryRun(unittest.TestCase):
    def test_empty_source_is_low_ir(self):
        ir = normalize(_art("low", kind="decompile", content=""), try_slither=False)
        self.assertEqual(ir.ir_confidence, "low")
        self.assertTrue(ir.lift_failed)

    def test_decompile_never_high(self):
        ir = normalize(_art("low", kind="decompile", content="function withdraw() public { msg.sender.transfer(1); }"), try_slither=False)
        self.assertEqual(ir.ir_confidence, "low")

    def test_lane_a_writes_bucket_to_memory_store(self):
        fixtures = ROOT / "tests" / "fixtures"
        store = MemoryStore()
        result = lane_a_one(
            ADDR,
            store=store,
            source_path=fixtures / "utility_no_movers.sol",
            tvl_usd=0,
        )
        self.assertFalse(result.dropped)
        self.assertIn(result.bucket, {"lane-a-cool", "human-no-candidate", "manual-review"})
        rows = store.list_results(ADDR)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["bucket"], result.bucket)

    def test_gated_fixture_does_not_auto_yes(self):
        store = MemoryStore()
        result = lane_a_one(
            "0x" + "22" * 20,
            store=store,
            source_path=ROOT / "tests" / "fixtures" / "gated_vault.sol",
            tvl_usd=100,
        )
        self.assertNotEqual(result.bucket, "human-yes-candidate")

    def test_open_withdraw_fixture_heats_or_manual(self):
        store = MemoryStore()
        result = lane_a_one(
            "0x" + "33" * 20,
            store=store,
            source_path=ROOT / "tests" / "fixtures" / "open_vault.sol",
            tvl_usd=100,
        )
        self.assertIn(result.bucket, {"lane-b-queue", "manual-review", "lane-a-cool"})
        self.assertNotEqual(result.bucket, "human-yes-candidate")


if __name__ == "__main__":
    unittest.main()
