import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIXTURE_PLACEHOLDER, runLaneA } from "./run-lane-a";
import { ensurePortablePython, portablePythonBin } from "./python-runtime";

const savedPython = process.env.ETH_SCANNER_PYTHON;
const savedWork = process.env.ETH_SCANNER_WORK_DIR;
const work = mkdtempSync(path.join(tmpdir(), "eth-scanner-lane-a-"));

before(() => {
  process.env.ETH_SCANNER_WORK_DIR = work;
});

after(() => {
  if (savedPython == null) delete process.env.ETH_SCANNER_PYTHON;
  else process.env.ETH_SCANNER_PYTHON = savedPython;
  if (savedWork == null) delete process.env.ETH_SCANNER_WORK_DIR;
  else process.env.ETH_SCANNER_WORK_DIR = savedWork;
});

describe("runLaneA fixture", () => {
  it("classifies gated_vault via system python -m eth_scanner", async () => {
    delete process.env.ETH_SCANNER_PYTHON;
    const out = await runLaneA({ fixture: "gated_vault" });
    assert.equal(out.ok, true, out.ok ? "" : out.error);
    if (!out.ok) return;
    assert.equal(out.fixture, "gated_vault");
    assert.equal(out.dry_run, true);
    assert.equal(out.result.address, FIXTURE_PLACEHOLDER);
    assert.ok(out.result.bucket);
    assert.ok(["high", "med"].includes(out.result.src_confidence || ""));
  });

  it("rejects an unknown fixture without spawning", async () => {
    const out = await runLaneA({ fixture: "not_a_real_fixture" });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.match(out.error, /unknown fixture/);
  });

  it("reports live_ingest when ETHERSCAN_API_KEYS is unset", async () => {
    const saved = process.env.ETHERSCAN_API_KEYS;
    delete process.env.ETHERSCAN_API_KEYS;
    try {
      const out = await runLaneA({ fixture: "not_a_real_fixture" });
      assert.equal(out.live_ingest, true);
      assert.equal(out.ok, false);
    } finally {
      if (saved == null) delete process.env.ETHERSCAN_API_KEYS;
      else process.env.ETHERSCAN_API_KEYS = saved;
    }
  });
});

describe("portable CPython pin", () => {
  it("runs the same fixture through the bundled interpreter", async (t) => {
    if (process.platform !== "linux") {
      t.skip("portable CPython is linux-gnu only");
      return;
    }
    const bin = ensurePortablePython();
    assert.equal(bin, portablePythonBin());
    process.env.ETH_SCANNER_PYTHON = bin;
    const out = await runLaneA({ fixture: "vanilla_erc20" });
    assert.equal(out.ok, true, out.ok ? "" : out.error);
    if (!out.ok) return;
    assert.equal(out.fixture, "vanilla_erc20");
    assert.equal(out.result.address, FIXTURE_PLACEHOLDER);
    assert.ok(out.result.bucket);
  });
});
