"""L4+ built-in fuzz harness. Dry-run without forge/echidna must pass."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.research.fuzz import (
    ECHIDNA_CONTRACTS,
    materialize_fuzz_project,
    packaged_fuzz_dir,
    parse_echidna_output,
    parse_forge_output,
    run_echidna,
    run_forge_fuzz,
    run_fuzz_layer,
)

ADDR = "0x" + "d2" * 20


class PackagedHarness(unittest.TestCase):
    def test_packaged_files_exist(self):
        root = packaged_fuzz_dir()
        self.assertTrue((root / "foundry.toml").is_file())
        self.assertTrue((root / "echidna.yaml").is_file())
        self.assertTrue((root / "src" / "MockVault.sol").is_file())
        self.assertTrue((root / "src" / "MockStaking.sol").is_file())
        self.assertTrue((root / "src" / "MockLending.sol").is_file())
        self.assertTrue((root / "test" / "VaultConservation.t.sol").is_file())
        self.assertTrue((root / "test" / "StakingBalance.t.sol").is_file())
        self.assertTrue((root / "test" / "LendingSolvency.t.sol").is_file())
        for name in ECHIDNA_CONTRACTS:
            self.assertTrue((root / "echidna" / ("%s.sol" % name)).is_file())

    def test_templates_are_defensive(self):
        root = packaged_fuzz_dir()
        blob = ""
        for p in root.rglob("*.sol"):
            blob += p.read_text(encoding="utf-8").lower()
        self.assertNotIn("function attack", blob)
        self.assertNotIn("vm.prank(", blob)
        self.assertIn("defensive", blob)

    def test_materialize_copies_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "fuzz"
            out = materialize_fuzz_project(dest)
            self.assertTrue((out / "foundry.toml").is_file())
            self.assertTrue((out / "src" / "MockVault.sol").is_file())


class Parsers(unittest.TestCase):
    def test_forge_pass_and_fail(self):
        text = """
[PASS] testFuzz_depositKeepsShareSolvency(uint96) (runs: 64)
[PASS] invariant_shareSolvency() (runs: 8)
[FAIL: assertion failed] testFuzz_shareAssetRoundTrip(uint96)
Suite result: FAILED. 2 passed; 1 failed; 0 skipped; finished in 1.00s
"""
        parsed = parse_forge_output(text)
        self.assertEqual(parsed["passed_n"], 2)
        self.assertEqual(parsed["failed_n"], 1)
        self.assertFalse(parsed["suite_ok"])
        self.assertTrue(any("RoundTrip" in x for x in parsed["failed"]))

    def test_echidna_pass(self):
        text = "echidna_share_solvency: passed! ✓\nechidna_no_free_shares: passed! ✓"
        parsed = parse_echidna_output(text)
        self.assertEqual(parsed["passed_n"], 2)
        self.assertEqual(parsed["failed_n"], 0)
        self.assertTrue(parsed["ok"])

    def test_echidna_fail(self):
        text = "echidna_share_solvency: failed!💥\nProperty echidna_no_free_shares passed!"
        parsed = parse_echidna_output(text)
        self.assertGreaterEqual(parsed["failed_n"], 1)


class SkipIfMissing(unittest.TestCase):
    def test_forge_skip_without_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = materialize_fuzz_project(Path(tmp) / "fuzz")
            with patch("eth_scanner.research.fuzz.forge_available", return_value=False):
                rc, note, parsed = run_forge_fuzz(dest)
            self.assertIsNone(rc)
            self.assertIn("forge not on PATH", note)
            self.assertEqual(parsed["failed_n"], 0)

    def test_echidna_skip_without_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = materialize_fuzz_project(Path(tmp) / "fuzz")
            with patch("eth_scanner.research.fuzz.echidna_available", return_value=False):
                rc, note, _ = run_echidna(dest)
            self.assertIsNone(rc)
            self.assertIn("echidna not on PATH", note)

    def test_layer_dry_run_without_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("eth_scanner.research.fuzz.forge_available", return_value=False), \
                 patch("eth_scanner.research.fuzz.echidna_available", return_value=False):
                findings, skips, notes, project = run_fuzz_layer(
                    address=ADDR, dest_dir=Path(tmp) / "fuzz",
                )
            self.assertIsNotNone(project)
            self.assertTrue(all(f.defensive_only for f in findings))
            self.assertTrue(any(f.detector == "fuzz:harness" for f in findings))
            self.assertTrue(any(f.detector == "fuzz:forge" for f in findings))
            self.assertTrue(any(f.detector == "fuzz:echidna" for f in findings))
            self.assertTrue(any("forge not on PATH" in s.reason for s in skips))
            self.assertTrue(any("harness written" in n for n in notes))


class OptionalLiveForge(unittest.TestCase):
    def test_forge_executes_when_present(self):
        from eth_scanner.research.fuzz import forge_available
        if not forge_available():
            self.skipTest("forge not on PATH")
        with tempfile.TemporaryDirectory() as tmp:
            findings, skips, notes, project = run_fuzz_layer(
                address=ADDR,
                dest_dir=Path(tmp) / "fuzz",
                fuzz_runs=8,
                try_echidna=False,
            )
            self.assertIsNotNone(project)
            forge_rows = [f for f in findings if f.detector == "fuzz:forge"]
            self.assertTrue(forge_rows)
            self.assertNotIn("skipped", forge_rows[0].title.lower())
            self.assertTrue(any("forge test" in n for n in notes))


if __name__ == "__main__":
    unittest.main()
