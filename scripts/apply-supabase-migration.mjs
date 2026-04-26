#!/usr/bin/env node
/*
 * Apply a single SQL migration file against a Supabase project using the
 * Supabase Management API. This is the only fully-automated path that
 * doesn't require a direct Postgres connection string.
 *
 * Requires a Supabase *personal access token* (a.k.a. "access token"),
 * NOT a service-role key. Generate one here:
 *
 *     https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   node scripts/apply-supabase-migration.mjs <path-to-sql-file>
 *
 * Env vars (both required):
 *   SUPABASE_ACCESS_TOKEN   your personal access token
 *   SUPABASE_PROJECT_REF    the 20-char project ref (from the dashboard
 *                           URL: supabase.com/dashboard/project/<ref>)
 *
 * The script splits the file on top-level `;\n` boundaries that are not
 * inside a `$$ ... $$` block or a single-quoted literal, then sends each
 * statement to the project's /database/query endpoint. It stops on the
 * first error and prints exactly where it failed.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const endpoint = (ref) => `https://api.supabase.com/v1/projects/${ref}/database/query`;

/**
 * Derive a CLI-compatible migration version + name from the filename.
 * `2026-04-25-permawrite-repo-uniqueness.sql` → `{ version: "20260425000000",
 * name: "permawrite_repo_uniqueness" }`. This matches the
 * YYYYMMDDHHMMSS convention Supabase's CLI uses for
 * `supabase_migrations.schema_migrations` so the dashboard lists it
 * alongside CLI-applied migrations.
 */
function parseMigrationMeta(filePath) {
  const base = basename(filePath).replace(/\.sql$/i, "");
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})[-_](.+)$/);
  if (m) {
    const [, y, mo, d, rest] = m;
    return {
      version: `${y}${mo}${d}000000`,
      name: rest.replace(/[-\s]+/g, "_").replace(/[^a-z0-9_]/gi, "").toLowerCase(),
    };
  }
  // Fallback: current timestamp + whole filename.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    version: `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`,
    name: base.replace(/[-\s]+/g, "_").replace(/[^a-z0-9_]/gi, "").toLowerCase(),
  };
}

function splitSqlStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inDollar = false;
  let dollarTag = "";
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next2 = sql.slice(i, i + 2);

    // Line comments
    if (!inSingle && !inDouble && !inDollar && next2 === "--") {
      const eol = sql.indexOf("\n", i);
      buf += sql.slice(i, eol === -1 ? n : eol + 1);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    // Block comments
    if (!inSingle && !inDouble && !inDollar && next2 === "/*") {
      const end = sql.indexOf("*/", i + 2);
      buf += sql.slice(i, end === -1 ? n : end + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // Dollar-quote (e.g. $$ ... $$ or $tag$ ... $tag$)
    if (!inSingle && !inDouble && c === "$") {
      // Detect a tag: $identifier$ (or $$ — empty tag)
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        if (inDollar && tag === dollarTag) {
          buf += tag;
          i += tag.length;
          inDollar = false;
          dollarTag = "";
          continue;
        } else if (!inDollar) {
          buf += tag;
          i += tag.length;
          inDollar = true;
          dollarTag = tag;
          continue;
        }
      }
    }
    if (!inDollar && !inDouble && c === "'") {
      inSingle = !inSingle;
      buf += c; i++;
      continue;
    }
    if (!inDollar && !inSingle && c === '"') {
      inDouble = !inDouble;
      buf += c; i++;
      continue;
    }
    if (c === ";" && !inSingle && !inDouble && !inDollar) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

async function runQuery({ ref, token, sql }) {
  const res = await fetch(endpoint(ref), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/apply-supabase-migration.mjs <path-to-sql-file>");
    process.exit(1);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    console.error("Missing SUPABASE_ACCESS_TOKEN and/or SUPABASE_PROJECT_REF env vars.");
    console.error("Get a personal access token at https://supabase.com/dashboard/account/tokens");
    console.error("Your project ref is the 20-char slug in the dashboard URL.");
    process.exit(1);
  }

  const sql = readFileSync(resolve(file), "utf8");
  const statements = splitSqlStatements(sql);
  const meta = parseMigrationMeta(file);
  console.log(`→ Applying ${statements.length} statement(s) from ${file}`);
  console.log(`  Project: ${ref}`);
  console.log(`  Version: ${meta.version}  Name: ${meta.name}`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, " ").slice(0, 90);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}${stmt.length > 90 ? "..." : ""} ... `);
    try {
      await runQuery({ ref, token, sql: stmt });
      console.log("ok");
    } catch (e) {
      console.log("FAIL");
      console.error(`\nStatement ${i + 1} failed:\n`);
      console.error(stmt);
      console.error(`\nError: ${e.message}`);
      process.exit(2);
    }
  }

  // Register in supabase_migrations.schema_migrations so this shows up in
  // the Dashboard → Database → Migrations tab. Idempotent on the
  // combination of (version, name): if a migration with the same NAME
  // already exists we skip, otherwise we allocate the next free version
  // slot on the same date so two migrations on one day don't collide.
  process.stdout.write("  ↳ Recording in schema_migrations ... ");
  try {
    // Skip if this migration name is already tracked.
    const existing = await runQuery({
      ref, token,
      sql: `select version from supabase_migrations.schema_migrations where name = '${meta.name.replace(/'/g, "''")}' limit 1;`,
    });
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`already tracked (version ${existing[0].version})`);
    } else {
      // Find next free version on this date (YYYYMMDDxxxxxx).
      const datePrefix = meta.version.slice(0, 8);
      const used = await runQuery({
        ref, token,
        sql: `select version from supabase_migrations.schema_migrations where version like '${datePrefix}%' order by version desc limit 1;`,
      });
      let version = meta.version;
      if (Array.isArray(used) && used.length > 0) {
        const topUsed = used[0].version;
        const nextNum = (parseInt(topUsed.slice(8), 10) || 0) + 1;
        version = `${datePrefix}${String(nextNum).padStart(6, "0")}`;
      }
      const tag = `MIG_${Date.now().toString(36)}`;
      const registerSql = `insert into supabase_migrations.schema_migrations (version, name, statements)
values (
  '${version}',
  '${meta.name}',
  array[$${tag}$${sql}$${tag}$]::text[]
);`;
      await runQuery({ ref, token, sql: registerSql });
      console.log(`ok (version ${version})`);
    }
  } catch (e) {
    // Non-fatal: the DDL is applied even if tracking fails. Schema may
    // not exist yet on brand-new projects, or permissions may differ.
    console.log(`skipped (${e.message.split("\n")[0]})`);
  }

  console.log("\n✓ All statements applied successfully.");
}

main().catch((e) => { console.error(e); process.exit(1); });
