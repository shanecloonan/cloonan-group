"""End-to-end research dry-run on known vault fixtures. No network keys."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.cli import main as root_cli
from eth_scanner.config import Settings
from eth_scanner.research.cli import main as research_cli
from eth_scanner.research.pipeline import dry_run_on_fixture, run_research, should_proceed
from eth_scanner.store.supabase import MemoryStore
from eth_scanner.types import FunnelResult

FIXTURES = ROOT / "tests" / "fixtures"
VAULT_ADDR = "0x" + "d2" * 20
YEARN_ADDR = "0x" + "d3" * 20
USDC_ADDR = "0x" + "c1" * 20


class Gate(unittest.TestCase):
    def test_in_scope_proceeds(self):
        ok, reason = should_proceed(FunnelResult(
            bucket="lane-b-queue", dropped=False, drop_reason=None,
            heat=4, src_confidence="high", ir_confidence="high",
            contract_class="vault", scope="in-scope",
        ))
        self.assertTrue(ok)
        self.assertIn("in-scope", reason)

    def test_token_stops(self):
        ok, reason = should_proceed(FunnelResult(
            bucket="lane-a-cool", dropped=False, drop_reason=None,
            heat=0, src_confidence="high", ir_confidence="high",
            contract_class="token", scope="demoted-token",
        ))
        self.assertFalse(ok)
        self.assertIn("gated out", reason)


class EndToEndVaults(unittest.TestCase):
    def _run(self, fixture: str, address: str, work: Path):
        settings = Settings(dry_run=True, work_dir=work)
        return run_research(
            address,
            settings=settings,
            store=MemoryStore(work_dir=work),
            source_path=FIXTURES / fixture,
            write_receipts=True,
            try_slither=True,
            try_forge=True,
            fork_mock={"totalAssets": 1, "convertToAssets_totalSupply": 1},
        )

    def test_erc4626_and_yearn_produce_receipts(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            a = self._run("erc4626_vault_like.sol", VAULT_ADDR, work)
            b = self._run("yearn_v2_like.sol", YEARN_ADDR, work)
            for run, role in ((a, "vault"), (b, "vault")):
                self.assertFalse(run.gated, run.gate_reason)
                self.assertEqual(run.role, role)
                self.assertIsNotNone(run.contract_ir)
                self.assertIsNotNone(run.funds_flow)
                self.assertIn("L1", run.layers_run)
                self.assertIn("L0", run.layers_run)
                self.assertIn("L3", run.layers_run)
                self.assertIn("L4", run.layers_run)
                self.assertTrue(run.findings)
                self.assertTrue(all(f.defensive_only for f in run.findings))
                self.assertTrue(run.receipt_md_path)
                self.assertTrue(run.receipt_json_path)
                md = Path(run.receipt_md_path)
                js = Path(run.receipt_json_path)
                self.assertTrue(md.is_file())
                self.assertTrue(js.is_file())
                text = md.read_text(encoding="utf-8")
                self.assertIn("# ETH research receipt", text)
                payload = json.loads(js.read_text(encoding="utf-8"))
                self.assertEqual(payload["address"], run.address)
                self.assertTrue(payload["defensive_only"])
            self.assertTrue(any("slither" in (s.reason + "".join(a.notes)).lower() for s in a.layers_skipped)
                            or "L2-slither" in a.layers_run)

    def test_usdc_token_stops_at_l1(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            run = self._run("usdc_like.sol", USDC_ADDR, work)
            self.assertTrue(run.gated)
            self.assertIsNone(run.contract_ir)
            self.assertTrue(any(s.layer == "L2" for s in run.layers_skipped))
            self.assertTrue(Path(run.receipt_md_path).is_file())

    def test_dry_run_helper(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = dry_run_on_fixture(
                FIXTURES / "erc4626_vault_like.sol",
                VAULT_ADDR,
                work_dir=Path(tmp),
                fork_mock={"totalAssets": 2, "convertToAssets_totalSupply": 2},
            )
            self.assertFalse(run.gated)
            self.assertTrue(run.invariant_paths)


class ResearchCli(unittest.TestCase):
    def test_version_and_run(self):
        buf = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(err):
            rc = research_cli(["version"])
        self.assertEqual(rc, 0)
        self.assertIn("0.1.0", buf.getvalue())

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "receipts"
            out = io.StringIO()
            err2 = io.StringIO()
            with redirect_stdout(out), redirect_stderr(err2):
                rc = research_cli([
                    "run",
                    "--address", VAULT_ADDR,
                    "--source", str(FIXTURES / "erc4626_vault_like.sol"),
                    "--dry-run",
                    "--receipt-dir", str(dest),
                    "--no-slither",
                    "--no-forge",
                ])
            self.assertEqual(rc, 0, err2.getvalue())
            payload = json.loads(out.getvalue())
            self.assertEqual(payload["address"], VAULT_ADDR)
            self.assertFalse(payload["gated"])
            self.assertTrue(list(dest.glob("research-*.md")))
            self.assertTrue(list(dest.glob("research-*.json")))

    def test_root_cli_forwards_research(self):
        buf = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(err):
            rc = root_cli(["research", "version"])
        self.assertEqual(rc, 0)
        self.assertIn("0.1.0", buf.getvalue())

    def test_generate_invariants(self):
        with tempfile.TemporaryDirectory() as tmp:
            buf = io.StringIO()
            err = io.StringIO()
            with redirect_stdout(buf), redirect_stderr(err):
                rc = research_cli([
                    "generate-invariants", "--role", "vault", "--out", tmp,
                    "--address", VAULT_ADDR,
                ])
            self.assertEqual(rc, 0)
            self.assertTrue((Path(tmp) / "VaultInvariants.t.sol").is_file())


if __name__ == "__main__":
    unittest.main()
