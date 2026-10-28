/**
 * Download a Markdown scan receipt for one /test target.
 * Read-only. .md only. Noindex via the /test page; not public nav.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { latestResearchReceipt, latestWrittenReceipt, loadDryRunStore, pickSourceArtifact } from "@/lib/eth-scanner/local-store";
import { receiptFilename, renderReceiptMarkdown } from "@/lib/eth-scanner/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://xvjqxjakckkbfsdrntwk.supabase.co";

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isAddress(raw: string | null): raw is string {
  return !!raw && /^0x[0-9a-fA-F]{40}$/.test(raw);
}

function mdResponse(markdown: string, filename: string) {
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addressRaw = url.searchParams.get("address");
  const kind = (url.searchParams.get("kind") || "").trim().toLowerCase();
  if (!isAddress(addressRaw)) {
    return NextResponse.json({ ok: false, error: "pass ?address=0x…" }, { status: 400 });
  }
  const address = addressRaw.toLowerCase();

  if (kind === "research") {
    const research = latestResearchReceipt(address);
    if (!research) {
      return NextResponse.json({
        ok: false,
        error: "no research receipt — run the research tab (writes eth-scanner/work/receipts/research-*.md)",
      }, { status: 404 });
    }
    return mdResponse(research.markdown, research.filename);
  }

  const written = latestWrittenReceipt(address);
  if (written) {
    return mdResponse(written.markdown, written.filename);
  }

  const sb = serviceClient();
  if (sb) {
    const [targetRes, resultRes, artRes] = await Promise.all([
      sb.from("eth_scan_targets").select("*").eq("address", address).maybeSingle(),
      sb
        .from("eth_scan_results")
        .select("id,address,bucket,heat,stage_trace,hypotheses,notes,created_at")
        .eq("address", address)
        .order("created_at", { ascending: false })
        .limit(1),
      sb
        .from("eth_scan_artifacts")
        .select("kind,path_or_json,confidence,created_at")
        .eq("address", address)
        .in("kind", ["source", "decompile"])
        .order("created_at", { ascending: false })
        .limit(4),
    ]);
    const target = targetRes.data;
    const result = resultRes.data?.[0];
    if (!target && !result) {
      return NextResponse.json({ ok: false, error: "no stored result for that address" }, { status: 404 });
    }
    const artifact = pickSourceArtifact(
      (artRes.data || []).map((row) => ({ ...row, address })),
      address,
    );
    const lane = Array.isArray(result?.stage_trace) && result.stage_trace.some((s: { stage?: string }) => s.stage === "S7")
      ? "B"
      : "A";
    const markdown = renderReceiptMarkdown({
      address,
      lane,
      generatedAt: result?.created_at || new Date().toISOString(),
      target,
      result: result
        ? {
            bucket: result.bucket,
            heat: result.heat,
            stage_trace: result.stage_trace,
            hypotheses: result.hypotheses,
            notes: result.notes,
            src_confidence: target?.src_confidence,
            ir_confidence: target?.ir_confidence,
            created_at: result.created_at,
          }
        : null,
      artifact,
    });
    return mdResponse(markdown, receiptFilename(address, lane, result?.created_at));
  }

  const store = loadDryRunStore();
  if (!store) {
    return NextResponse.json({
      ok: false,
      error: "no receipt data — run Lane A/B (writes eth-scanner/work/receipts/) or persist with the service role",
    }, { status: 404 });
  }
  const target = store.targets.find((t) => String(t.address).toLowerCase() === address) || null;
  const result = store.results.find((r) => String(r.address).toLowerCase() === address) || null;
  if (!target && !result) {
    return NextResponse.json({ ok: false, error: "no stored result for that address" }, { status: 404 });
  }
  const artifact = pickSourceArtifact(store.artifacts, address);
  const trace = (result?.stage_trace as { stage?: string }[] | undefined) || [];
  const lane = trace.some((s) => s.stage === "S7") ? "B" : "A";
  const markdown = renderReceiptMarkdown({
    address,
    lane,
    generatedAt: String(result?.created_at || new Date().toISOString()),
    target,
    result: result
      ? {
          bucket: result.bucket as string | null,
          heat: result.heat as number | null,
          stage_trace: result.stage_trace as never,
          hypotheses: result.hypotheses as never,
          notes: result.notes as string | null,
          src_confidence: (target?.src_confidence as string) || null,
          ir_confidence: (target?.ir_confidence as string) || null,
          created_at: result.created_at as string | null,
        }
      : null,
    artifact,
  });
  return mdResponse(markdown, receiptFilename(address, lane, result?.created_at as string | undefined));
}
