import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractJsonObject, FIXTURE_PLACEHOLDER, resolveResearchFixture, runResearch } from "./run-research";

const savedPython = process.env.ETH_SCANNER_PYTHON;
const savedWork = process.env.ETH_SCANNER_WORK_DIR;
const work = mkdtempSync(path.join(tmpdir(), "eth-scanner-research-"));

before(() => {
  process.env.ETH_SCANNER_WORK_DIR = work;
});

after(() => {
  if (savedPython == null) delete process.env.ETH_SCANNER_PYTHON;
  else process.env.ETH_SCANNER_PYTHON = savedPython;
  if (savedWork == null) delete process.env.ETH_SCANNER_WORK_DIR;
  else process.env.ETH_SCANNER_WORK_DIR = savedWork;
});

describe("runResearch fixture", () => {
  it("extracts a JSON object from pretty-printed stdout", () => {
    const payload = extractJsonObject('note\n{\n  "address": "0x11",\n  "gated": false\n}\n');
    assert.equal((payload as { address: string }).address, "0x11");
  });

  it("resolves research fixtures and rejects unknown ids", () => {
    const ok = resolveResearchFixture("erc4626_vault");
    assert.ok(ok);
    assert.match(ok.abs, /erc4626_vault_like\.sol$/);
    assert.equal(resolveResearchFixture("not_a_real_fixture"), null);
  });

  it("dry-runs erc4626_vault via python -m eth_scanner.research", async () => {
    delete process.env.ETH_SCANNER_PYTHON;
    const out = await runResearch({ fixture: "erc4626_vault" });
    assert.equal(out.ok, true, out.ok ? "" : out.error);
    if (!out.ok) return;
    assert.equal(out.fixture, "erc4626_vault");
    assert.equal(out.dry_run, true);
    assert.equal(out.result.address, FIXTURE_PLACEHOLDER);
    assert.equal(out.result.defensive_only, true);
    assert.ok(out.result.layers_run.includes("L1"));
    assert.ok(out.result.findings.length > 0);
    assert.ok(out.result.findings.every((f) => f.defensive_only));
  });
});
