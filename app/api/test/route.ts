/**
 * Read-only ETH scanner triage feed for /test.
 * Uses the service-role key server-side only. Never a scanner runtime.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://xvjqxjakckkbfsdrntwk.supabase.co";

const BUCKETS = [
  "lane-a-cool",
  "lane-b-queue",
  "manual-review",
  "human-no-candidate",
  "human-yes-candidate",
] as const;

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 80)));
  const sb = serviceClient();

  if (!sb) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      buckets: BUCKETS,
      counts: Object.fromEntries(BUCKETS.map((b) => [b, 0])),
      targets: [],
      results: [],
      note: "SUPABASE_SERVICE_ROLE_KEY unset — /test is read-only and empty. Lane A/B dry-run writes eth-scanner/work/ instead.",
    });
  }

  let targetsQuery = sb
    .from("eth_scan_targets")
    .select("address,bytecode_hash,tvl_usd,status,src_confidence,ir_confidence,heat,bucket,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (bucket && (BUCKETS as readonly string[]).includes(bucket)) {
    targetsQuery = targetsQuery.eq("bucket", bucket);
  }

  const [targetsRes, resultsRes] = await Promise.all([
    targetsQuery,
    sb
      .from("eth_scan_results")
      .select("id,address,bucket,heat,stage_trace,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (targetsRes.error || resultsRes.error) {
    const err = targetsRes.error?.message || resultsRes.error?.message || "query failed";
    const missing = /does not exist|schema cache|relation/i.test(err);
    return NextResponse.json({
      ok: true,
      dry_run: missing,
      buckets: BUCKETS,
      counts: Object.fromEntries(BUCKETS.map((b) => [b, 0])),
      targets: [],
      results: [],
      note: missing
        ? "eth_scan_* tables missing — apply infra/supabase/migrations/2026-10-27-eth-scanner-queue.sql"
        : err,
    });
  }

  const targets = targetsRes.data ?? [];
  const counts: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const t of targets) {
    if (t.bucket && counts[t.bucket] != null) counts[t.bucket] += 1;
  }

  return NextResponse.json({
    ok: true,
    dry_run: false,
    buckets: BUCKETS,
    counts,
    targets,
    results: resultsRes.data ?? [],
    note: "Read-only triage. Automation never stamps yes. Low IR stays in manual-review.",
  });
}
