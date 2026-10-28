"""Markdown scan receipts — shape, redaction, CLI path print.

No network. No exploit fixtures. User-facing format is .md only.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.cli import main as cli_main
from eth_scanner.funnel.s0_s7 import FunnelContext, run_lane_a
from eth_scanner.receipt import (
    REQUIRED_HEADINGS,
    build_context,
    pick_source_artifact,
    redact_text,
    render_markdown,
    write_run_receipt,
)
from eth_scanner.types import FunctionIR, IRDocument, SourceArtifact, Target

ADDR = "0x" + "11" * 20


def _art() -> SourceArtifact:
    return SourceArtifact(
        kind="source",
        language="solidity",
        content="pragma solidity ^0.8.20;\ncontract C { function withdraw() external {} }",
        src_confidence="high",
        verified_match="exact",
        tool="local",
        contract_name="C",
        notes=["local source (--source); treated as verified for dry-run"],
    )


def _ir() -> IRDocument:
    return IRDocument(
        functions=[
            FunctionIR(
                name="withdraw",
                visibility="external",
                line=2,
                fund_signals=["withdraw"],
                auth_heuristic="PRESENT",
                is_value_mover=True,
                exposed=True,
            )
        ],
        ir_confidence="high",
        src_confidence="high",
        language="solidity",
        lift_tool="test",
    )


class ReceiptShape(unittest.TestCase):
    def test_markdown_has_required_sections_and_bucket_label(self):
        result = run_lane_a(FunnelContext(
            target=Target(address=ADDR, has_code=True, tvl_usd=0),
            artifact=_art(),
            ir=_ir(),
        ))
        md = render_markdown(build_context(
            address=ADDR, lane="A", result=result, artifact=_art(),
            target=Target(address=ADDR, tvl_usd=0, status="done"),
        ))
        self.assertTrue(md.startswith("# ETH scanner receipt"))
        for heading in REQUIRED_HEADINGS:
            self.assertIn("## %s" % heading, md)
        self.assertIn("bucket, not a verdict", md.lower())
        self.assertIn("**Bucket:**", md)
        self.assertIn("leads**, never findings", md.lower())
        self.assertIn(ADDR, md)
        self.assertIn("Lane A", md)
        self.assertIn("`S0`", md)
        self.assertIn("Do Not Auto-Dismiss", md)
        self.assertIn("Handoff for another AI", md)
        self.assertIn("do not auto-yes", md.lower())
        self.assertIn("lead for manual reading", md.lower())
        self.assertIn("## Leads (not findings)", md)
        self.assertIn("**Contract class:**", md)
        self.assertIn("**Lane scope:**", md)
        self.assertIn("**Scope signals:**", md)
        self.assertIn("Picker:", md)

    def test_pattern_lead_uses_description(self):
        ir = _ir()
        result = run_lane_a(FunnelContext(
            target=Target(address=ADDR, has_code=True, tvl_usd=0),
            artifact=_art(),
            ir=ir,
        ))
        payload = result.to_dict()
        payload["pattern_leads"] = [{"id": "erc4626-rounding", "description": "ERC4626 convert/preview surface"}]
        md = render_markdown(build_context(
            address=ADDR, lane="A", result=payload, artifact=_art(),
            target=Target(address=ADDR, tvl_usd=0, status="done"),
        ))
        self.assertIn("ERC4626 convert/preview surface", md)

    def test_write_run_receipt_creates_md_under_receipts(self):
        result = run_lane_a(FunnelContext(
            target=Target(address=ADDR, has_code=True, tvl_usd=0),
            artifact=_art(),
            ir=_ir(),
        ))
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "receipts"
            path = write_run_receipt(
                address=ADDR, lane="A", result=result,
                artifact=_art(), dest_dir=dest,
            )
            self.assertTrue(path.is_file())
            self.assertEqual(path.suffix, ".md")
            self.assertTrue(path.name.startswith("receipt-%s-lane-a-" % ADDR))
            text = path.read_text(encoding="utf-8")
            self.assertIn("# ETH scanner receipt", text)
            self.assertIn(str(result.bucket), text)

    def test_explicit_receipt_path(self):
        result = run_lane_a(FunnelContext(
            target=Target(address=ADDR, has_code=True),
            artifact=_art(),
            ir=_ir(),
        ))
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "custom-name.md"
            path = write_run_receipt(
                address=ADDR, lane="A", result=result, dest_file=dest,
            )
            self.assertEqual(path, dest)
            self.assertTrue(dest.is_file())

    def test_redacts_secrets_from_notes_and_extras(self):
        dirty = {
            "notes": ["ETHERSCAN_API_KEY=abc123secret", "ok note"],
            "stage_trace": [{
                "stage": "S1",
                "decision": "tag",
                "reason": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
                "extras": {"api_key": "should-not-leak", "heat": 1},
            }],
            "bucket": "manual-review",
            "src_confidence": "low",
            "ir_confidence": "low",
            "heat": 0,
        }
        md = render_markdown(build_context(address=ADDR, lane="A", result=dirty))
        self.assertNotIn("abc123secret", md)
        self.assertNotIn("should-not-leak", md)
        self.assertNotIn("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", md)
        self.assertIn("[redacted]", md)

    def test_redact_text_helper(self):
        out = redact_text({"service_role": "secret-value", "heat": 3})
        self.assertEqual(out["service_role"], "[redacted]")
        self.assertEqual(out["heat"], 3)

    def test_pick_source_artifact_strips_content(self):
        rows = [{
            "kind": "source",
            "confidence": "high",
            "created_at": "2026-10-27T00:00:00Z",
            "path_or_json": {"tool": "local", "content": "pragma SECRET", "kind": "source"},
        }]
        picked = pick_source_artifact(rows)
        self.assertEqual(picked.get("tool"), "local")
        self.assertNotIn("content", picked)


class ReceiptCli(unittest.TestCase):
    def test_lane_a_dry_run_prints_and_writes_md(self):
        fixture = ROOT / "tests" / "fixtures" / "gated_vault.sol"
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            env = os.environ
            prev = {k: env.get(k) for k in (
                "ETH_SCANNER_WORK_DIR", "ETH_SCANNER_DRY_RUN", "SUPABASE_SERVICE_ROLE_KEY",
            )}
            env["ETH_SCANNER_WORK_DIR"] = str(work)
            env["ETH_SCANNER_DRY_RUN"] = "1"
            env.pop("SUPABASE_SERVICE_ROLE_KEY", None)
            try:
                stdout = io.StringIO()
                stderr = io.StringIO()
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    rc = cli_main([
                        "lane-a",
                        "--address", ADDR,
                        "--source", str(fixture),
                        "--dry-run",
                    ])
                self.assertEqual(rc, 0)
                err = stderr.getvalue()
                self.assertIn("receipt ", err)
                self.assertIn(".md", err)
                payload = json.loads(stdout.getvalue())
                self.assertEqual(len(payload), 1)
                receipt_path = Path(payload[0]["receipt_path"])
                self.assertTrue(receipt_path.is_file())
                self.assertEqual(receipt_path.suffix, ".md")
                self.assertTrue((work / "receipts").is_dir())
                text = receipt_path.read_text(encoding="utf-8")
                self.assertIn("# ETH scanner receipt", text)
                self.assertIn(ADDR, text)
                self.assertIn("**Bucket:**", text)
            finally:
                for k, v in prev.items():
                    if v is None:
                        env.pop(k, None)
                    else:
                        env[k] = v

    def test_receipt_flag_writes_named_file(self):
        fixture = ROOT / "tests" / "fixtures" / "utility_no_movers.sol"
        with tempfile.TemporaryDirectory() as tmp:
            named = Path(tmp) / "out.md"
            env = os.environ
            prev_work = env.get("ETH_SCANNER_WORK_DIR")
            env["ETH_SCANNER_WORK_DIR"] = tmp
            env["ETH_SCANNER_DRY_RUN"] = "1"
            env.pop("SUPABASE_SERVICE_ROLE_KEY", None)
            try:
                stdout = io.StringIO()
                stderr = io.StringIO()
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    rc = cli_main([
                        "lane-a",
                        "--address", ADDR,
                        "--source", str(fixture),
                        "--dry-run",
                        "--receipt", str(named),
                    ])
                self.assertEqual(rc, 0)
                self.assertTrue(named.is_file())
                self.assertIn(str(named), stderr.getvalue())
            finally:
                if prev_work is None:
                    env.pop("ETH_SCANNER_WORK_DIR", None)
                else:
                    env["ETH_SCANNER_WORK_DIR"] = prev_work

    def test_no_receipt_skips_write(self):
        fixture = ROOT / "tests" / "fixtures" / "utility_no_movers.sol"
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ
            env["ETH_SCANNER_WORK_DIR"] = tmp
            env["ETH_SCANNER_DRY_RUN"] = "1"
            env.pop("SUPABASE_SERVICE_ROLE_KEY", None)
            stdout = io.StringIO()
            stderr = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                rc = cli_main([
                    "lane-a",
                    "--address", ADDR,
                    "--source", str(fixture),
                    "--dry-run",
                    "--no-receipt",
                ])
            self.assertEqual(rc, 0)
            self.assertIsNone(json.loads(stdout.getvalue())[0]["receipt_path"])
            self.assertFalse((Path(tmp) / "receipts").exists())


if __name__ == "__main__":
    unittest.main()
