import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  listPythonCandidates,
  missingPythonError,
  portablePythonBin,
  pythonHomeFor,
  pythonRuntimeStatus,
} from "./python-runtime";

const saved = {
  python: process.env.ETH_SCANNER_PYTHON,
  vercel: process.env.VERCEL,
};

afterEach(() => {
  if (saved.python == null) delete process.env.ETH_SCANNER_PYTHON;
  else process.env.ETH_SCANNER_PYTHON = saved.python;
  if (saved.vercel == null) delete process.env.VERCEL;
  else process.env.VERCEL = saved.vercel;
});

describe("listPythonCandidates", () => {
  it("prefers ETH_SCANNER_PYTHON and skips PATH names", () => {
    process.env.ETH_SCANNER_PYTHON = "/opt/custom/python3";
    const bins = listPythonCandidates();
    assert.equal(bins[0]?.source, "env");
    assert.equal(bins[0]?.bin, "/opt/custom/python3");
    assert.ok(!bins.some((c) => c.source === "path"));
  });

  it("falls back to python3 then python when no override", () => {
    delete process.env.ETH_SCANNER_PYTHON;
    const bins = listPythonCandidates();
    const pathBins = bins.filter((c) => c.source === "path").map((c) => c.bin);
    assert.deepEqual(pathBins, ["python3", "python"]);
  });

  it("includes a bundled interpreter when bin/python3 exists", () => {
    delete process.env.ETH_SCANNER_PYTHON;
    const fakeRoot = mkdtempSync(path.join(tmpdir(), "eth-scanner-rt-"));
    const bin = portablePythonBin(fakeRoot);
    mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, "#!/bin/sh\n");
    const bundled = listPythonCandidates(fakeRoot).find((c) => c.source === "bundled");
    assert.ok(bundled);
    assert.equal(bundled.bin, bin);
    assert.equal(pythonHomeFor("bundled", bin), path.join(fakeRoot, "eth-scanner", ".runtime", "python"));
  });
});

describe("missingPythonError", () => {
  it("mentions Vercel Node serverless when VERCEL is set", () => {
    process.env.VERCEL = "1";
    const msg = missingPythonError("could not start python3", ["python3", "python"]);
    assert.match(msg, /could not start python3/);
    assert.match(msg, /Vercel Node serverless has no system Python/);
    assert.match(msg, /eth-scanner\/\.runtime\/python/);
  });

  it("mentions a real local interpreter when not on Vercel", () => {
    delete process.env.VERCEL;
    const msg = missingPythonError("could not start python3", ["python3"]);
    assert.match(msg, /Windows Store stub/);
    assert.match(msg, /ETH_SCANNER_PYTHON/);
  });
});

describe("pythonRuntimeStatus", () => {
  it("reports env override without claiming a bundle", () => {
    process.env.ETH_SCANNER_PYTHON = "python3";
    const st = pythonRuntimeStatus(path.join(tmpdir(), "no-such-eth-scanner-root"));
    assert.equal(st.env_override, true);
    assert.equal(st.bundled, false);
  });
});
