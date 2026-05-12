/**
 * Walks the repo (excluding build artifacts and dependencies) and writes
 * CODEBASE_STATS.md — lines of code, file counts, extension breakdown,
 * top-level area totals, and largest source files.
 *
 * Usage: node scripts/codebase-stats.mjs [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "CODEBASE_STATS.md");

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "build",
  "coverage",
  ".vercel",
  "dist",
  ".turbo",
  "__pycache__",
  ".pnpm-store",
]);

/** Generated dependency locks — excluded from line counts (still omitted from "largest files"). */
const SKIP_BASENAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

/** Treat as non-source for LOC tables (still counted in "other files" if we list all — we skip entirely). */
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".eot",
  ".ttf",
  ".otf",
  ".pdf",
  ".zip",
  ".lock",
]);

const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".css",
  ".scss",
  ".html",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".sql",
  ".rs",
  ".toml",
  ".sh",
  ".service",
]);

const MAX_FILE_BYTES = 4 * 1024 * 1024;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function countLines(text) {
  if (text.length === 0) return { total: 0, nonEmpty: 0 };
  const lines = text.split(/\r\n|\n|\r/);
  const total = lines.length;
  const nonEmpty = lines.reduce((n, line) => n + (/[^\s]/.test(line) ? 1 : 0), 0);
  return { total, nonEmpty };
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

function topLevelPrefix(relPath) {
  const i = relPath.indexOf("/");
  return i === -1 ? "(root)" : relPath.slice(0, i);
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const files = walk(ROOT);

  const byExt = new Map();
  const byTop = new Map();
  const fileMeta = [];

  let scanned = 0;
  let skippedBinary = 0;
  let skippedHuge = 0;

  for (const full of files) {
    const r = rel(full);
    if (r.startsWith(".git/")) continue;
    if (r === "CODEBASE_STATS.md") continue;
    if (SKIP_BASENAMES.has(path.basename(full))) continue;

    const ext = path.extname(full).toLowerCase() || "(no ext)";
    if (SKIP_EXT.has(ext)) {
      skippedBinary++;
      continue;
    }

    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) {
      skippedHuge++;
      continue;
    }

    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      skippedBinary++;
      continue;
    }
    if (text.includes("\u0000")) {
      skippedBinary++;
      continue;
    }

    const buf = Buffer.from(text, "utf8");
    const { total, nonEmpty } = countLines(text);
    scanned++;

    const isSource = SOURCE_EXT.has(ext);
    fileMeta.push({
      rel: r,
      ext,
      lines: total,
      nonEmpty,
      bytes: buf.length,
      isSource,
    });

    if (!isSource) continue;

    if (!byExt.has(ext)) byExt.set(ext, { files: 0, lines: 0, nonEmpty: 0, bytes: 0 });
    const e = byExt.get(ext);
    e.files++;
    e.lines += total;
    e.nonEmpty += nonEmpty;
    e.bytes += buf.length;

    const top = topLevelPrefix(r);
    if (!byTop.has(top)) byTop.set(top, { files: 0, lines: 0, nonEmpty: 0 });
    const t = byTop.get(top);
    t.files++;
    t.lines += total;
    t.nonEmpty += nonEmpty;
  }

  const sourceFiles = fileMeta.filter((f) => f.isSource);
  const totalSourceLines = sourceFiles.reduce((a, f) => a + f.lines, 0);
  const totalSourceNonEmpty = sourceFiles.reduce((a, f) => a + f.nonEmpty, 0);
  const totalSourceBytes = sourceFiles.reduce((a, f) => a + f.bytes, 0);

  const extRows = [...byExt.entries()]
    .sort((a, b) => b[1].lines - a[1].lines)
    .map(([ext, v]) => ({ ext, ...v }));

  const topRows = [...byTop.entries()]
    .sort((a, b) => b[1].lines - a[1].lines)
    .map(([name, v]) => ({ name, ...v }));

  const largest = [...sourceFiles].sort((a, b) => b.lines - a.lines).slice(0, 20);

  const generated = new Date().toISOString();

  const md = `# Codebase stats

Auto-generated snapshot of this repository (source and config-like text files under the repo root; \`node_modules\`, \`.next\`, build output, and common binary assets are excluded).

**Generated (UTC):** ${generated}

**Regenerate:** \`npm run codebase-stats\`

## Summary

| Metric | Value |
| --- | ---: |
| Source-like files scanned | ${sourceFiles.length.toLocaleString()} |
| Total lines (all scanned source-like files) | ${totalSourceLines.toLocaleString()} |
| Non-empty lines | ${totalSourceNonEmpty.toLocaleString()} |
| UTF-8 bytes (source-like) | ${totalSourceBytes.toLocaleString()} |
| Paths visited (before binary/huge skip) | ${files.length.toLocaleString()} |
| Skipped (binary / non-UTF8 / over ${MAX_FILE_BYTES >> 20} MiB) | ${(skippedBinary + skippedHuge).toLocaleString()} |

## Lines of code by top-level directory

Directories are the first path segment (e.g. \`app\`, \`lib\`). Only source-like extensions are included in line counts.

| Directory | Files | Lines | Non-empty lines |
| --- | ---: | ---: | ---: |
${topRows.map((r) => `| \`${r.name}\` | ${r.files.toLocaleString()} | ${r.lines.toLocaleString()} | ${r.nonEmpty.toLocaleString()} |`).join("\n")}

## Lines of code by file extension

| Extension | Files | Lines | Non-empty lines | Bytes |
| --- | ---: | ---: | ---: | ---: |
${extRows.map((r) => `| \`${r.ext}\` | ${r.files.toLocaleString()} | ${r.lines.toLocaleString()} | ${r.nonEmpty.toLocaleString()} | ${r.bytes.toLocaleString()} |`).join("\n")}

## Largest source files (by line count)

| Lines | File |
| ---: | --- |
${largest.map((f) => `| ${f.lines.toLocaleString()} | \`${f.rel}\` |`).join("\n")}

## Notes

- **Lines** include blank lines and comments; **non-empty** ignores lines that are only whitespace.
- **Source-like** extensions: ${[...SOURCE_EXT].sort().map((x) => `\`${x}\``).join(", ")}.
- **Lockfiles** (\`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`) are excluded from all tables so totals reflect authored source.
`;

  if (dry) {
    process.stdout.write(md);
    return;
  }

  fs.writeFileSync(OUT, md, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
  console.log(
    `Source files: ${sourceFiles.length}, lines: ${totalSourceLines}, non-empty: ${totalSourceNonEmpty}`,
  );
}

main();
