"""Multi-file unpack + mover classification. No network. No exploit fixtures."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eth_scanner.heuristics.invariant_pass import is_wrap_unwrap, run_scan, run_scan_source
from eth_scanner.ingest.unpack import (
    flatten_sources,
    looks_like_etherscan_json,
    materialize_source,
    parse_etherscan_sources,
    select_ir_artifact,
    unpack_to_dir,
)
from eth_scanner.ir.normalize import normalize
from eth_scanner.lane_a.worker import run_one as lane_a_one
from eth_scanner.store.supabase import MemoryStore
from eth_scanner.types import FunctionIR, SourceArtifact

from eth_scanner.funnel.s0_s7 import FunnelContext, run_lane_a
from eth_scanner.types import IRDocument, Target

POOL_SOL = """pragma solidity ^0.8.20;
interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
}
contract LendingPool {
    function deposit(address asset, uint256 amt) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amt);
    }
    function borrow(uint256 amt) external {
        payable(msg.sender).transfer(amt);
    }
}
"""

IERC20_SOL = """pragma solidity ^0.8.20;
interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
}
"""

VAT_SOL = """pragma solidity ^0.8.20;
contract VatLike {
    mapping (address => uint256) public dai;
    function frob(bytes32 ilk, address u, address v, address w, int dink, int dart) external {
        dai[u] = dai[u];
        ilk; v; w; dink; dart;
    }
    function flux(bytes32 ilk, address src, address dst, uint256 wad) external {
        require(msg.sender == src);
        ilk; dst; wad;
    }
    function move(address src, address dst, uint256 rad) external {
        require(msg.sender == src);
        dai[src] = dai[src] - rad;
        dai[dst] = dai[dst] + rad;
    }
}
"""


def _standard_json(*pairs: tuple[str, str]) -> str:
    payload = {"language": "Solidity", "sources": {path: {"content": src} for path, src in pairs}}
    return "{" + json.dumps(payload) + "}"


def _art(content: str, **kw) -> SourceArtifact:
    base = dict(
        kind="source",
        language="solidity",
        content=content,
        src_confidence="high",
        verified_match="exact",
        tool="test",
    )
    base.update(kw)
    return SourceArtifact(**base)  # type: ignore[arg-type]


class UnpackEtherscanJson(unittest.TestCase):
    def test_standard_json_double_brace(self):
        raw = _standard_json(("contracts/LendingPool.sol", POOL_SOL), ("contracts/IERC20.sol", IERC20_SOL))
        self.assertTrue(raw.startswith("{{"))
        self.assertTrue(looks_like_etherscan_json(raw))
        files = parse_etherscan_sources(raw)
        self.assertIn("contracts/LendingPool.sol", files)
        self.assertIn("function deposit", files["contracts/LendingPool.sol"])

    def test_sources_map_without_wrapper(self):
        raw = json.dumps({"sources": {"A.sol": {"content": POOL_SOL}}})
        files = parse_etherscan_sources(raw)
        self.assertEqual(set(files), {"A.sol"})

    def test_rejects_path_traversal(self):
        raw = json.dumps({"sources": {"../../etc/passwd.sol": {"content": POOL_SOL}}})
        files = parse_etherscan_sources(raw)
        self.assertTrue(files)
        rel = next(iter(files))
        self.assertFalse(rel.startswith(".."))
        self.assertNotIn("..", Path(rel).parts)

    def test_json_blob_scan_misses_movers_unpack_finds_them(self):
        raw = _standard_json(("contracts/LendingPool.sol", POOL_SOL))
        blob = run_scan_source(raw, filename="Contract.sol")
        self.assertEqual(blob["summary"]["fund_movers"], 0)
        files = parse_etherscan_sources(raw)
        with tempfile.TemporaryDirectory(prefix="eth-scanner-test-") as tmp:
            dest = unpack_to_dir(files, Path(tmp))
            unpacked = run_scan([str(dest)])
        names = [m["fn"] for f in unpacked["files"] for m in f.get("fund_movers", [])]
        self.assertIn("deposit", names)
        self.assertIn("borrow", names)

    def test_normalize_unpacks_without_source_dir(self):
        raw = _standard_json(("contracts/LendingPool.sol", POOL_SOL), ("lib/IERC20.sol", IERC20_SOL))
        ir = normalize(_art(raw), try_slither=False)
        names = {fn.name for fn in ir.functions if fn.is_value_mover}
        self.assertIn("deposit", names)
        self.assertIn("borrow", names)
        self.assertFalse(ir.lift_failed)
        self.assertTrue(any("unpack" in n.lower() for n in ir.notes))

    def test_lib_prefix_sources_are_scanned(self):
        raw = _standard_json(("lib/aave-v3/src/contracts/protocol/pool/Pool.sol", POOL_SOL))
        ir = normalize(_art(raw), try_slither=False)
        names = {fn.name for fn in ir.functions if fn.is_value_mover}
        self.assertIn("deposit", names)
        self.assertFalse(ir.lift_failed)

    def test_flatten_keeps_solidity_visible(self):
        files = {"B.sol": "contract B {}", "A.sol": "contract A {}"}
        flat = flatten_sources(files)
        self.assertIn("// ----- file: A.sol -----", flat)
        self.assertIn("contract A", flat)

    def test_materialize_mutates_artifact_content(self):
        raw = _standard_json(("Pool.sol", POOL_SOL))
        art = _art(raw)
        with tempfile.TemporaryDirectory(prefix="eth-scanner-test-") as tmp:
            art, src_dir = materialize_source(art, Path(tmp))
            self.assertIsNotNone(src_dir)
            self.assertTrue(list(Path(src_dir).rglob("*.sol")))
        self.assertIn("function deposit", art.content)
        self.assertTrue(art.content.strip().startswith("// ----- file:"))


class ProxyImplForIR(unittest.TestCase):
    def test_impl_source_wins_for_lift(self):
        proxy = _art("contract Proxy {}", is_proxy=True, implementation="0x" + "ab" * 20)
        impl = _art(POOL_SOL, contract_name="LendingPool")
        chosen = select_ir_artifact(proxy, impl)
        self.assertIn("deposit", chosen.content)
        self.assertTrue(chosen.is_proxy)
        self.assertEqual(chosen.implementation, "0x" + "ab" * 20)
        self.assertTrue(any("implementation" in n.lower() for n in chosen.notes))

    def test_empty_impl_keeps_proxy(self):
        proxy = _art("contract Proxy { fallback() external {} }", is_proxy=True, implementation="0x" + "cd" * 20)
        impl = _art("")
        chosen = select_ir_artifact(proxy, impl)
        self.assertIn("fallback", chosen.content)
        self.assertTrue(any("empty" in n.lower() for n in chosen.notes))


class MoverClassification(unittest.TestCase):
    def test_vanilla_erc20_not_custody_movers(self):
        src = (ROOT / "tests" / "fixtures" / "vanilla_erc20.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        roles = {fn.name: fn.role for fn in ir.functions}
        self.assertEqual(roles.get("transfer"), "erc20-standard")
        self.assertEqual(roles.get("transferFrom"), "erc20-standard")
        custody = [fn.name for fn in ir.functions if fn.is_value_mover and fn.exposed]
        self.assertEqual(custody, [])

    def test_weth_wrap_unwrap_classified(self):
        src = (ROOT / "tests" / "fixtures" / "weth_like.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        by_name = {fn.name: fn for fn in ir.functions}
        self.assertEqual(by_name["withdraw"].role, "wrap-unwrap")
        self.assertEqual(by_name["deposit"].role, "wrap-unwrap")
        self.assertEqual(by_name["withdraw"].auth_heuristic, "PRESENT")
        self.assertEqual(by_name["transfer"].role, "erc20-standard")
        self.assertTrue(is_wrap_unwrap("withdraw", src))

    def test_open_vault_withdraw_is_not_wrap(self):
        src = (ROOT / "tests" / "fixtures" / "open_vault.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        wd = next(fn for fn in ir.functions if fn.name == "withdraw")
        self.assertEqual(wd.role, "custody")
        self.assertNotEqual(wd.auth_heuristic, "PRESENT")

    def test_maker_like_names_are_movers(self):
        ir = normalize(_art(VAT_SOL), try_slither=False)
        names = {fn.name for fn in ir.functions if fn.is_value_mover}
        self.assertTrue({"frob", "flux", "move"} <= names)

    def test_low_level_call_does_not_fail_lift(self):
        src = (ROOT / "tests" / "fixtures" / "callsite_vault.sol").read_text(encoding="utf-8")
        ir = normalize(_art(src), try_slither=False)
        self.assertFalse(ir.lift_failed)
        self.assertNotEqual(ir.ir_confidence, "low")
        names = {fn.name for fn in ir.functions}
        self.assertIn("deposit", names)


class LaneADryRunBuckets(unittest.TestCase):
    def test_multifile_json_source_not_false_empty(self):
        raw = _standard_json(("contracts/LendingPool.sol", POOL_SOL))
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
            fh.write(raw)
            path = Path(fh.name)
        try:
            result = lane_a_one(
                "0x" + "44" * 20,
                store=MemoryStore(),
                source_path=path,
                tvl_usd=0,
            )
        finally:
            path.unlink(missing_ok=True)
        self.assertFalse(result.dropped)
        self.assertNotEqual(result.bucket, "human-no-candidate")
        self.assertTrue(set(result.value_movers) & {"deposit", "borrow"})
        self.assertNotEqual(result.bucket, "human-yes-candidate")

    def test_vanilla_erc20_demoted_cool(self):
        result = lane_a_one(
            "0x" + "55" * 20,
            store=MemoryStore(),
            source_path=ROOT / "tests" / "fixtures" / "vanilla_erc20.sol",
            tvl_usd=50_000,
        )
        self.assertEqual(result.bucket, "lane-a-cool")
        self.assertEqual(result.scope, "demoted-token")
        self.assertNotIn("transfer", result.value_movers)
        self.assertNotEqual(result.bucket, "human-yes-candidate")
        self.assertNotEqual(result.bucket, "lane-b-queue")

    def test_weth_unwrap_demoted_not_lane_b(self):
        result = lane_a_one(
            "0x" + "66" * 20,
            store=MemoryStore(),
            source_path=ROOT / "tests" / "fixtures" / "weth_like.sol",
            tvl_usd=9_999_999,
        )
        self.assertEqual(result.bucket, "lane-a-cool")
        self.assertEqual(result.scope, "demoted-token")
        self.assertEqual(result.contract_class, "wrap-token")
        self.assertNotEqual(result.bucket, "human-yes-candidate")
        self.assertTrue(set(result.value_movers) & {"withdraw", "deposit"})

    def test_erc20_role_on_injected_ir_is_not_a_custody_close_blocker(self):
        transfer = FunctionIR(
            name="transfer", visibility="public", line=4, file="T.sol",
            fund_signals=["(name only: transfer)"], auth_heuristic="PRESENT",
            is_value_mover=False, exposed=True, role="erc20-standard",
        )
        ir = IRDocument(
            functions=[transfer], ir_confidence="high", src_confidence="high",
            language="solidity", lift_tool="test",
        )
        r = run_lane_a(FunnelContext(
            target=Target(address="0x" + "11" * 20, has_code=True, tvl_usd=0),
            artifact=_art("pragma solidity ^0.8.20;\ncontract C {}"),
            ir=ir,
        ))
        self.assertEqual(r.bucket, "human-no-candidate")


if __name__ == "__main__":
    unittest.main()
