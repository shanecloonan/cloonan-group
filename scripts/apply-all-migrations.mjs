#!/usr/bin/env node
/*
 * Apply every .sql migration under infra/supabase/migrations in filename
 * order (which is YYYY-MM-DD... so naturally chronological).
 *
 * Skips any migration already recorded in schema_migrations by name.
 * Idempotent — safe to re-run.
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF  (see scripts/apply-
 * supabase-migration.mjs docs).
 */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dir = resolve("infra/supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No .sql files in infra/supabase/migrations");
  process.exit(0);
}

console.log(`Found ${files.length} migration file(s):`);
for (const f of files) console.log(`  • ${f}`);
console.log();

let failed = 0;
for (const f of files) {
  const full = resolve(dir, f);
  const r = spawnSync("node", ["scripts/apply-supabase-migration.mjs", full], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\n✗ ${f} failed (exit ${r.status}). Stopping.`);
    failed++;
    break;
  }
  console.log();
}

if (failed === 0) {
  console.log("✓ All migrations applied.");
} else {
  process.exit(1);
}
