"""Research finding schema + IR/receipt shapes. No network. No exploits."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.research.receipt import render_research_markdown, write_research_receipts
from eth_scanner.research.types import Finding, ResearchRun, SEVERITIES


class FindingSchema(unittest.TestCase):
    def test_defensive_only_forced(self):
        f = Finding(
            id="x",
            severity="high",
            layer="L2",
            title="t",
            evidence="e",
            address="0x" + "11" * 20,
            detector="t",
            defensive_only=False,
        )
        self.assertTrue(f.defensive_only)
        self.assertTrue(f.to_dict()["defensive_only"])

    def test_severity_aliases(self):
        self.assertEqual(Finding(
            id="a", severity="medium", layer="L2", title="t",
            evidence="e", address="0x", detector="d",
        ).severity, "med")
        self.assertEqual(Finding(
            id="b", severity="critical", layer="L3", title="t",
            evidence="e", address="0x", detector="d",
        ).severity, "crit")
        self.assertEqual(Finding(
            id="c", severity="nope", layer="LX", title="t",
            evidence="e", address="0x", detector="d",
        ).severity, "info")
        self.assertEqual(Finding(
            id="d", severity="low", layer="LX", title="t",
            evidence="e", address="0x", detector="d",
        ).layer, "L2")

    def test_all_severities_roundtrip(self):
        for sev in SEVERITIES:
            d = Finding(
                id="id-%s" % sev, severity=sev, layer="L4",
                title="t", evidence="e", address="0x", detector="d",
            ).to_dict()
            self.assertEqual(d["severity"], sev)
            self.assertEqual(d["layer"], "L4")


class ReceiptShape(unittest.TestCase):
    def test_markdown_and_json_written(self):
        addr = "0x" + "ab" * 20
        run = ResearchRun(
            address=addr,
            gated=False,
            gate_reason="lane-a in-scope funds-at-risk (vault)",
            role="vault",
            scope="in-scope",
            layers_run=["L1", "L0", "L3"],
            findings=[Finding(
                id="L3-authority-summary-1",
                severity="info",
                layer="L3",
                title="Funds-flow / authority summary",
                evidence="0 sink(s)",
                address=addr,
                detector="funds-flow:summary",
            )],
            notes=["Phase 1"],
        )
        md = render_research_markdown(run, generated_at="2026-10-28T00:00:00Z")
        self.assertTrue(md.startswith("# ETH research receipt"))
        self.assertIn("defensive_only=true", md)
        self.assertIn("Do **not** write exploits", md)
        self.assertIn(addr, md)
        with tempfile.TemporaryDirectory() as tmp:
            md_path, json_path = write_research_receipts(
                run, dest_dir=Path(tmp), generated_at="2026-10-28T00:00:00Z",
            )
            self.assertTrue(md_path.is_file())
            self.assertTrue(json_path.is_file())
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertTrue(payload["defensive_only"])
            self.assertEqual(payload["findings"][0]["defensive_only"], True)
            self.assertIn("stack_version", payload)


if __name__ == "__main__":
    unittest.main()
