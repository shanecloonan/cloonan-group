"""L4 template generation + L2 custom detectors. No forge required."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.research.detectors import (
    detect_oracle_freshness,
    detect_share_asset_shape,
    detect_weak_auth_value_moves,
)
from eth_scanner.research.fork_checks import TotalAssetsCheck, run_fork_checks
from eth_scanner.research.invariants import (
    generate_invariant_stubs,
    is_foundry_project,
    load_template,
    run_forge_test,
)
from eth_scanner.research.slither_runner import parse_slither_json

FIXTURES = ROOT / "tests" / "fixtures"
ADDR = "0x" + "d2" * 20


class TemplateGeneration(unittest.TestCase):
    def test_vault_staking_lending_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            for role, needle in (
                ("vault", "test_template_share_solvency"),
                ("staking", "test_template_account_lte_total"),
                ("lending", "test_template_cash_plus_borrows"),
            ):
                paths = generate_invariant_stubs(role, dest, address=ADDR)
                self.assertEqual(len(paths), 1)
                text = paths[0].read_text(encoding="utf-8")
                self.assertIn(needle, text)
                self.assertNotIn("function attack", text.lower())
                self.assertNotIn("vm.prank", text.lower())
                self.assertIn("Defensive", text)

    def test_unknown_role_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(generate_invariant_stubs("router", Path(tmp)), [])

    def test_load_template_matches_files(self):
        text = load_template("vault")
        self.assertIn("IVaultLike", text)

    def test_foundry_fixture_detected_but_forge_skips(self):
        project = FIXTURES / "research_foundry"
        self.assertTrue(is_foundry_project(project))
        with patch("eth_scanner.research.invariants.forge_available", return_value=False):
            rc, note = run_forge_test(project)
        self.assertIsNone(rc)
        self.assertIn("forge not on PATH", note)


class CustomDetectors(unittest.TestCase):
    def test_open_vault_flags_missing_auth(self):
        src = (FIXTURES / "open_vault.sol").read_text(encoding="utf-8")
        rows = detect_weak_auth_value_moves(address=ADDR, source=src)
        self.assertTrue(rows)
        self.assertTrue(all(r.defensive_only for r in rows))
        self.assertTrue(any(r.severity in {"high", "med"} for r in rows))

    def test_gated_vault_no_missing_auth_from_source(self):
        src = (FIXTURES / "gated_vault.sol").read_text(encoding="utf-8")
        rows = detect_weak_auth_value_moves(address=ADDR, source=src)
        self.assertEqual(rows, [])

    def test_4626_share_shape_info(self):
        src = (FIXTURES / "erc4626_vault_like.sol").read_text(encoding="utf-8")
        rows = detect_share_asset_shape(address=ADDR, source=src, role="vault")
        self.assertTrue(any("Share/asset accounting terms present" in r.title for r in rows))

    def test_oracle_without_freshness(self):
        src = (FIXTURES / "oracle_vault_like.sol").read_text(encoding="utf-8")
        rows = detect_oracle_freshness(address=ADDR, source=src)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].severity, "med")
        self.assertIn("freshness", rows[0].title.lower())

    def test_oracle_with_updated_at_is_info(self):
        src = """
        interface AggregatorV3Interface { function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80); }
        contract C { function p(AggregatorV3Interface f) public view returns (int256) {
            (, int256 a,, uint256 updatedAt,) = f.latestRoundData(); require(updatedAt + 1 hours > block.timestamp); return a;
        }}
        """
        rows = detect_oracle_freshness(address=ADDR, source=src)
        self.assertEqual(rows[0].severity, "info")


class SlitherParse(unittest.TestCase):
    def test_allowlist_and_noise_drop(self):
        payload = {
            "results": {
                "detectors": [
                    {"check": "reentrancy-eth", "impact": "High", "description": "reenter"},
                    {"check": "naming-convention", "impact": "Informational", "description": "style"},
                    {"check": "tx-origin", "impact": "Medium", "description": "tx.origin"},
                ]
            }
        }
        rows = parse_slither_json(payload, address=ADDR)
        checks = {r.detector for r in rows}
        self.assertIn("slither:reentrancy-eth", checks)
        self.assertIn("slither:tx-origin", checks)
        self.assertFalse(any("naming" in c for c in checks))
        self.assertEqual(rows[0].severity, "high")
        self.assertEqual(rows[0].layer, "L2")


class ForkScaffold(unittest.TestCase):
    def test_no_rpc_skips(self):
        finding, skip, _ = TotalAssetsCheck().run(ADDR)
        self.assertIsNotNone(finding)
        self.assertEqual(finding.detector, "fork:skipped")
        self.assertIsNotNone(skip)

    def test_mock_property_ok_and_fail(self):
        ok, skip, _ = TotalAssetsCheck().run(
            ADDR, mock={"totalAssets": 100, "convertToAssets_totalSupply": 99},
        )
        self.assertIsNone(skip)
        self.assertEqual(ok.severity, "info")
        bad, skip2, _ = TotalAssetsCheck().run(
            ADDR, mock={"totalAssets": 10, "convertToAssets_totalSupply": 50},
        )
        self.assertIsNone(skip2)
        self.assertEqual(bad.severity, "high")
        self.assertIn("exceeds", bad.title)

    def test_run_fork_checks_mock(self):
        findings, skips, notes = run_fork_checks(
            address=ADDR, role="vault",
            mock={"totalAssets": 5, "convertToAssets_totalSupply": 5},
        )
        self.assertTrue(findings)
        self.assertEqual(skips, [])
        self.assertTrue(any("mock" in n.lower() for n in notes))


if __name__ == "__main__":
    unittest.main()
