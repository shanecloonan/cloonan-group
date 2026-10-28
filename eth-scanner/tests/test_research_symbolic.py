"""Halmos / hevm wrappers skip when binaries are missing."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.research.fuzz import materialize_fuzz_project
from eth_scanner.research.symbolic import (
    HALMOS_CMD_DOC,
    HEVM_CMD_DOC,
    run_halmos,
    run_hevm,
    run_symbolic_layer,
)

ADDR = "0x" + "d2" * 20


class SkipIfMissing(unittest.TestCase):
    def test_halmos_skip_documents_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = materialize_fuzz_project(Path(tmp) / "fuzz")
            with patch("eth_scanner.research.symbolic.halmos_available", return_value=False):
                rc, note = run_halmos(dest)
            self.assertIsNone(rc)
            self.assertIn("halmos not on PATH", note)
            self.assertIn("halmos --function check_", note)

    def test_hevm_skip_documents_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = materialize_fuzz_project(Path(tmp) / "fuzz")
            with patch("eth_scanner.research.symbolic.hevm_available", return_value=False):
                rc, note = run_hevm(dest)
            self.assertIsNone(rc)
            self.assertIn("hevm not on PATH", note)
            self.assertIn("hevm symbolic", note)

    def test_layer_without_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = materialize_fuzz_project(Path(tmp) / "fuzz")
            with patch("eth_scanner.research.symbolic.halmos_available", return_value=False), \
                 patch("eth_scanner.research.symbolic.hevm_available", return_value=False):
                findings, skips, notes = run_symbolic_layer(address=ADDR, project_dir=dest)
            self.assertTrue(all(f.defensive_only for f in findings))
            self.assertTrue(any(f.detector == "symbolic:halmos" for f in findings))
            self.assertTrue(any(f.detector == "symbolic:hevm" for f in findings))
            self.assertTrue(any(s.layer == "L4" for s in skips))
            self.assertTrue(any(s.layer == "L5" for s in skips))
            self.assertTrue(any(HALMOS_CMD_DOC.split()[0] in n for n in notes))
            self.assertTrue(any("hevm" in n for n in notes))

    def test_layer_without_project(self):
        findings, skips, _ = run_symbolic_layer(address=ADDR, project_dir=None)
        self.assertTrue(skips)
        self.assertTrue(any(HEVM_CMD_DOC[:12] in s.reason or "hevm" in s.reason for s in skips))


if __name__ == "__main__":
    unittest.main()
