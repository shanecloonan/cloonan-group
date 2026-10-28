"""L3 funds-flow / authority graph. No path synthesis. No network."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.ir.normalize import normalize
from eth_scanner.research.funds_flow import build_funds_flow, funds_flow_findings
from eth_scanner.types import SourceArtifact

FIXTURES = ROOT / "tests" / "fixtures"
ADDR = "0x" + "11" * 20


def _ir(name: str):
    p = FIXTURES / name
    art = SourceArtifact(
        kind="source",
        language="solidity",
        content=p.read_text(encoding="utf-8"),
        src_confidence="high",
        verified_match="exact",
        tool="test",
    )
    return normalize(art, try_slither=False)


class FundsFlowParse(unittest.TestCase):
    def test_gated_vault_has_present_auth(self):
        ir = _ir("gated_vault.sol")
        graph = build_funds_flow(
            source=(FIXTURES / "gated_vault.sol").read_text(encoding="utf-8"),
            lane_ir=ir,
        )
        names = {s.name for s in graph.sinks}
        self.assertIn("withdraw", names)
        withdraw = next(s for s in graph.sinks if s.name == "withdraw")
        self.assertEqual(withdraw.gating, "PRESENT")
        self.assertTrue(graph.summary)
        self.assertTrue(any("No path synthesis" in n for n in graph.notes))

    def test_open_vault_is_missing_auth(self):
        ir = _ir("open_vault.sol")
        graph = build_funds_flow(
            source=(FIXTURES / "open_vault.sol").read_text(encoding="utf-8"),
            lane_ir=ir,
        )
        withdraw = next(s for s in graph.sinks if s.name == "withdraw")
        self.assertTrue(withdraw.exposed)
        self.assertIn(withdraw.gating, {"MISSING", "WEAK", "AMBIGUOUS", "MISSING(internal — check callers)"})
        self.assertNotEqual(withdraw.gating, "PRESENT")
        findings = funds_flow_findings(address=ADDR, graph=graph)
        ids = {f.id for f in findings}
        self.assertIn("L3-authority-summary-1", ids)
        self.assertTrue(any(f.detector == "funds-flow:ungated-sink" for f in findings))
        self.assertTrue(all(f.defensive_only for f in findings))

    def test_source_only_parse_without_lane_ir(self):
        src = (FIXTURES / "gated_vault.sol").read_text(encoding="utf-8")
        graph = build_funds_flow(source=src)
        self.assertTrue(any(s.name == "withdraw" for s in graph.sinks))
        withdraw = next(s for s in graph.sinks if s.name == "withdraw")
        self.assertIn("onlyOwner", withdraw.modifiers)
        self.assertEqual(withdraw.gating, "PRESENT")


if __name__ == "__main__":
    unittest.main()
