import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  TEST_ETHERSCAN_FALLBACK_KEY,
  capabilityNote,
  etherscanApiKeys,
  scannerCapabilities,
} from "./capabilities";

const savedKeys = process.env.ETHERSCAN_API_KEYS;
const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const savedDry = process.env.ETH_SCANNER_DRY_RUN;

afterEach(() => {
  if (savedKeys == null) delete process.env.ETHERSCAN_API_KEYS;
  else process.env.ETHERSCAN_API_KEYS = savedKeys;
  if (savedRole == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole;
  if (savedDry == null) delete process.env.ETH_SCANNER_DRY_RUN;
  else process.env.ETH_SCANNER_DRY_RUN = savedDry;
});

describe("etherscan /test fallback", () => {
  it("reports live_ingest when ETHERSCAN_API_KEYS is unset", () => {
    delete process.env.ETHERSCAN_API_KEYS;
    assert.equal(etherscanApiKeys(), TEST_ETHERSCAN_FALLBACK_KEY);
    assert.equal(scannerCapabilities().live_ingest, true);
  });

  it("reports live_ingest when ETHERSCAN_API_KEYS is empty", () => {
    process.env.ETHERSCAN_API_KEYS = "   ";
    assert.equal(etherscanApiKeys(), TEST_ETHERSCAN_FALLBACK_KEY);
    assert.equal(scannerCapabilities().live_ingest, true);
  });

  it("prefers a set ETHERSCAN_API_KEYS value", () => {
    process.env.ETHERSCAN_API_KEYS = "override-key, second-key";
    assert.equal(etherscanApiKeys(), "override-key, second-key");
    assert.equal(scannerCapabilities().live_ingest, true);
  });

  it("never puts the fallback key in capability notes", () => {
    delete process.env.ETHERSCAN_API_KEYS;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const note = capabilityNote(scannerCapabilities());
    assert.equal(note.includes(TEST_ETHERSCAN_FALLBACK_KEY), false);
    assert.match(note, /live verified-source fetch available/);
  });
});
