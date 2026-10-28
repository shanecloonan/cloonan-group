/**
 * Markdown scan receipt for /test download.
 * Mirrors eth-scanner/src/eth_scanner/receipt.py — user-facing format is .md only.
 * Automation emits buckets, never a human verdict. Leads, never findings.
 */

export const BUCKETS = [
  "lane-a-cool",
  "lane-b-queue",
  "manual-review",
  "human-no-candidate",
  "human-yes-candidate",
] as const;

export type Bucket = (typeof BUCKETS)[number];

export type StageStep = {
  stage?: string;
  decision?: string;
  reason?: string;
  extras?: Record<string, unknown>;
};

export type HypothesisRow = {
  invariant?: string;
  status?: string;
  score?: number;
  locus?: string;
  text?: string;
  notes?: string;
};

export type ReceiptInput = {
  address: string;
  lane?: string;
  generatedAt?: string;
  scannerId?: string;
  scannerVersion?: string;
  workerId?: string;
  target?: {
    address?: string;
    bytecode_hash?: string | null;
    tvl_usd?: number | string | null;
    status?: string | null;
    src_confidence?: string | null;
    ir_confidence?: string | null;
    heat?: number | null;
    bucket?: string | null;
    has_code?: boolean | null;
  } | null;
  result?: {
    bucket?: string | null;
    heat?: number | null;
    dropped?: boolean;
    drop_reason?: string | null;
    src_confidence?: string | null;
    ir_confidence?: string | null;
    stage_trace?: StageStep[] | null;
    hypotheses?: HypothesisRow[] | null;
    notes?: string | string[] | null;
    value_movers?: string[] | null;
    contract_class?: string | null;
    scope?: string | null;
    scope_signals?: string[] | null;
    pattern_leads?: { id?: string; name?: string; detail?: string; text?: string; description?: string }[] | null;
    created_at?: string | null;
  } | null;
  artifact?: {
    kind?: string | null;
    tool?: string | null;
    src_confidence?: string | null;
    verified_match?: string | null;
    language?: string | null;
    compiler?: string | null;
    contract_name?: string | null;
    is_proxy?: boolean | null;
    implementation?: string | null;
    notes?: string[] | string | null;
  } | null;
};

const BUCKET_MEANING: Record<string, string> = {
  "lane-a-cool": "High/usable IR, movers gated or none. Archive with score trail; human spot-check.",
  "lane-b-queue": "S6 gate (heat / TVL / weirdness). Promoted to Lane B. Not a finding.",
  "manual-review": "Low/failed confidence or ambiguous cheap check. Do Not Auto-Dismiss.",
  "human-no-candidate": "High-confidence all-clear candidate. Human still stamps no.",
  "human-yes-candidate": "BROKEN hypothesis with a locus. Human stamps yes after path verify (no PoC).",
};

const BUCKET_STAMP: Record<string, string> = {
  "lane-a-cool": "optional spot-check (not a close)",
  "lane-b-queue": "none yet — wait for Lane B",
  "manual-review": "required (needs-look). Do not stamp no from this bucket alone.",
  "human-no-candidate": "human stamps no",
  "human-yes-candidate": "human stamps yes only after reading the locus. Automation never stamps yes.",
};

const SECRET_KEY = /api[_-]?key|user[_-]?key|service[_-]?role|secret|private[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|mnemonic|seed[_-]?phrase|wallet[_-]?seed/i;
const SECRET_VALUE =
  /(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|(?:sk[_-][A-Za-z0-9]{16,})|(?:Bearer\s+[A-Za-z0-9._\-]+)/gi;

function redact(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "string") {
    let text = value.replace(SECRET_VALUE, "[redacted]");
    text = text.replace(
      /((?:api[_-]?key|user[_-]?key|service[_-]?role|secret|token|password|mnemonic)[^\s=]*)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    );
    return text;
  }
  return value;
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function fmt(value: unknown, empty = "unavailable"): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return empty;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function lanesFromTrace(trace: StageStep[], lane: string): string[] {
  const stages = trace.map((s) => s.stage || "");
  const found: string[] = [];
  if (stages.some((s) => ["S0", "S1", "S2", "S3", "S4", "S5", "S6"].includes(s)) || lane === "A") {
    found.push("A");
  }
  if (stages.some((s) => s === "S7") || lane === "B") found.push("B");
  return found.length ? [...new Set(found)] : [lane || "A"];
}

function handoffNext(
  bucket: string | null | undefined,
  src: unknown,
  ir: unknown,
  scope?: string | null,
): string {
  if ((scope === "demoted-token" || scope === "demoted-passthrough") && bucket === "lane-a-cool") {
    return "Out of Lane A funds-at-risk scope (token / wrap-token / pass-through router / atomic NFT market). Not competing for Lane B. Optional spot-check only.";
  }
  if (bucket === "manual-review" || src === "low" || ir === "low") {
    return "Manual read of movers + provenance. Do not close as no. If source is missing, fetch verified Etherscan or local --source and re-run Lane A.";
  }
  if (bucket === "lane-b-queue") {
    return "Run Lane B (`python -m eth_scanner lane-b --address <addr>`) then re-download this receipt.";
  }
  if (bucket === "human-yes-candidate") {
    return "Human path-verify the locus in prose. Stamp yes only after that. No PoC.";
  }
  if (bucket === "human-no-candidate") {
    return "Human stamps no if the all-clear still holds after a spot check.";
  }
  if (bucket === "lane-a-cool") {
    return "Optional human spot-check of the score trail. Not a silent close.";
  }
  if (!bucket) return "Intake dropped (EOA / non-ETH / closed-no duplicate). No bucket to stamp.";
  return "Re-read notes + stage_trace and decide a human stamp.";
}

export function receiptFilename(address: string, lane = "A", generatedAt?: string): string {
  const ts = (generatedAt || new Date().toISOString()).replace(/[^0-9TZ]/g, "").slice(0, 16) || "undated";
  return `receipt-${address.toLowerCase()}-lane-${lane.toLowerCase()}-${ts}.md`;
}

export function renderReceiptMarkdown(input: ReceiptInput): string {
  const res = (redact(input.result || {}) as ReceiptInput["result"]) || {};
  const art = (redact(input.artifact || {}) as ReceiptInput["artifact"]) || {};
  const tgt = (redact(input.target || {}) as ReceiptInput["target"]) || {};
  const trace = Array.isArray(res.stage_trace) ? res.stage_trace : [];
  const lane = (input.lane || "A").toUpperCase();
  const lanes = lanesFromTrace(trace, lane);
  const stages = [...new Set(trace.map((s) => s.stage).filter(Boolean))];
  const bucket = res.bucket ?? tgt.bucket ?? null;
  const notesRaw = res.notes;
  const notes = Array.isArray(notesRaw)
    ? notesRaw.filter(Boolean).map(String)
    : notesRaw
      ? String(notesRaw).split("\n").filter((l) => l.trim())
      : [];
  const leads = res.pattern_leads || [];
  const hyps = res.hypotheses || [];
  const movers = res.value_movers || [];
  const src = res.src_confidence || art.src_confidence || tgt.src_confidence;
  const ir = res.ir_confidence || tgt.ir_confidence;
  const heat = res.heat ?? tgt.heat;
  const generatedAt = input.generatedAt || res.created_at || new Date().toISOString();
  const scannerId = input.scannerId || "eth-scanner";
  const scannerVersion = input.scannerVersion || "0.3.3";
  const workerId = input.workerId || "eth-scanner";

  const stageRows =
    trace.length === 0
      ? ["| — | — | no stage_trace stored | |"]
      : trace.map((step) => {
          const extras = step.extras && Object.keys(step.extras).length
            ? `\`${esc(JSON.stringify(redact(step.extras)))}\``
            : "";
          return `| \`${esc(step.stage)}\` | \`${esc(step.decision)}\` | ${esc(step.reason)} | ${extras} |`;
        });

  const moverLines = movers.length ? movers.map((n) => `- \`${esc(n)}\``) : ["- none recorded"];
  const leadLines = leads.length
    ? leads.map((lead) => {
        const id = lead.id || lead.name || "lead";
        const detail = lead.description || lead.detail || lead.text || "";
        return `- \`${esc(id)}\` — ${esc(detail) || "see extras"} *(lead only)*`;
      })
    : ["- none recorded"];

  let hypBlock = "- none (Lane A often has no I1–I8 stubs; Lane B adds them).";
  if (hyps.length) {
    hypBlock = [
      "| Invariant | Status | Score | Locus | Text |",
      "| --- | --- | --- | --- | --- |",
      ...hyps.map(
        (h) =>
          `| \`${esc(h.invariant)}\` | \`${esc(h.status || "OPEN")}\` | ${esc(h.score ?? "—")} | \`${esc(h.locus || "—")}\` | ${esc(h.text || h.notes || "")} |`,
      ),
      "",
      "Status `BROKEN` on this receipt is only a **human-injected locus** routed to `human-yes-candidate`. Automation itself emits OPEN / HOLDS-shaped leads.",
    ].join("\n");
  }

  const artNotes = Array.isArray(art.notes) ? art.notes : art.notes ? [art.notes] : [];
  const provenanceNotes = artNotes.length
    ? ["- **Provenance notes:**", ...artNotes.map((n) => `  - ${esc(redact(n))}`)]
    : [];

  const meaning = BUCKET_MEANING[String(bucket)] || "Unknown / dropped before a bucket.";
  const stamp = BUCKET_STAMP[String(bucket)] || "human decides; automation does not";
  const next = handoffNext(bucket, src, ir, res.scope);
  const kind = art.kind || (src === "low" ? "decompile" : "unavailable");

  return [
    "# ETH scanner receipt",
    "",
    "> **Not a verdict.** Automation emitted a **bucket** (routing label).",
    "> Heuristic flags are **leads**, never findings. Do not auto-yes. Do not auto-no on low IR.",
    "> Defensive / read-only. Do not write exploits, PoCs, or fund-moving transactions from this file.",
    "",
    "## How to use this file",
    "",
    "Paste this Markdown into another AI chat (or a later six-pass read) as the full scan context.",
    "It is self-contained: identity, provenance, stages, leads, bucket, confidence, and notes.",
    "Source text is **not** embedded (size + secret hygiene). Re-fetch via `--source` or verified Etherscan.",
    "",
    "## Identity",
    "",
    `- **Scanner:** \`${scannerId}\` v${scannerVersion}`,
    `- **Worker id:** \`${workerId}\``,
    `- **Generated (UTC):** ${generatedAt}`,
    `- **Lane requested:** Lane ${lane}`,
    `- **Lanes evidenced:** ${lanes.map((x) => `Lane ${x}`).join(", ")}`,
    `- **Stages in trace:** ${stages.length ? stages.join(", ") : "unavailable"}`,
    "- **Chain:** `ethereum` (this environment is Ethereum-only)",
    "",
    "## Contract",
    "",
    `- **Address:** \`${input.address}\``,
    `- **Bytecode hash:** \`${fmt(tgt.bytecode_hash)}\``,
    `- **TVL USD (override / stored):** ${fmt(tgt.tvl_usd)}`,
    `- **Target status:** \`${fmt(tgt.status)}\``,
    `- **Has code:** ${fmt(tgt.has_code, "unknown")}`,
    `- **Contract class:** \`${fmt(res.contract_class)}\``,
    `- **Lane scope:** \`${fmt(res.scope)}\` — \`in-scope\` (funds-at-risk) · \`demoted-token\` · \`demoted-passthrough\` · \`utility\``,
    `- **Scope signals:** \`${fmt((res.scope_signals || []).join(",") || null)}\``,
    "- **Picker:** `in-scope` = venue where money sits at rest (vault/staking/lending/pool/bridge/maker). `demoted-token` / `demoted-passthrough` do not compete for Lane B. Buckets, never a verdict.",
    "",
    "## Source provenance",
    "",
    `- **Kind:** \`${fmt(kind)}\` — \`source\` = verified / local; \`decompile\` = hypothesis only`,
    `- **Tool:** \`${fmt(art.tool)}\` (etherscan | local | heimdall | panoramix | store | none)`,
    `- **src_confidence:** \`${fmt(src)}\` — high exact verified · med partial · low decompile only`,
    `- **verified_match:** \`${fmt(art.verified_match)}\``,
    `- **Language:** \`${fmt(art.language)}\``,
    `- **Compiler:** \`${fmt(art.compiler)}\``,
    `- **Contract name:** \`${fmt(art.contract_name)}\``,
    `- **Proxy:** ${fmt(art.is_proxy, "no")} · **implementation:** \`${fmt(art.implementation)}\``,
    ...provenanceNotes,
    "- Source body is omitted from this receipt. Low-confidence decompile is never proof.",
    "",
    "## Lanes and stages",
    "",
    "Lane A = S0–S6 cheap skim + gate. Lane B = S7 deep invariants (I1–I8 leads).",
    "",
    "| Stage | Decision | Reason | Extras |",
    "| --- | --- | --- | --- |",
    ...stageRows,
    "",
    "## Leads (not findings)",
    "",
    "Every row below is a **lead for manual reading**. Grep / heuristic hits never qualify as `yes`.",
    "",
    "### Exposed value movers",
    "",
    ...moverLines,
    "",
    "### Pattern skim (S3)",
    "",
    ...leadLines,
    "",
    "### Hypotheses (I1–I8 stubs)",
    "",
    hypBlock,
    "",
    "## Routing outcome (bucket, not a verdict)",
    "",
    `- **Bucket:** \`${fmt(bucket, "(none — dropped before routing)")}\``,
    `- **What that means:** ${meaning}`,
    `- **Human stamp:** ${stamp}`,
    `- **Dropped:** ${fmt(res.dropped, "no")}${res.drop_reason ? ` — \`${esc(res.drop_reason)}\`` : ""}`,
    `- **Heat (ranking only, never a dismiss):** ${fmt(heat, "0")}`,
    "",
    "Automation **never** stamps `yes` or `no`. `human-*-candidate` still needs a human.",
    "Low or failed IR → `manual-review` (Do Not Auto-Dismiss).",
    "",
    "## Confidence",
    "",
    `- **src_confidence:** \`${fmt(src)}\``,
    `- **ir_confidence:** \`${fmt(ir)}\``,
    "- Scale: `high` Slither SSA *or* clear heuristic on verified Solidity/Vyper · `med` partial / unparsed · `low` decompile or failed lift",
    "- Heimdall / Panoramix decompiles are hypothesis generators only (`src_confidence=low`).",
    "",
    "## Notes",
    "",
    ...(notes.length ? notes.map((n) => `- ${esc(redact(n))}`) : ["- none recorded"]),
    "",
    "## Handoff for another AI",
    "",
    "Continue from this receipt without the repo. Suggested posture:",
    "",
    "1. Treat the **bucket** as routing, not disclosure and not a close.",
    "2. Treat every heuristic / pattern / mover as a **lead**. Inventory paths in prose.",
    "3. If `ir_confidence` or `src_confidence` is `low`, or the bucket is `manual-review`, do **not** auto-dismiss. Read or escalate.",
    "4. If the bucket is `human-yes-candidate`, verify the locus by reading. **Do not** write a PoC, exploit, local-fork theft sim, or live transaction.",
    "5. If the bucket is `human-no-candidate`, a human still stamps `no`.",
    "",
    `**Suggested next:** ${next}`,
    "",
    "---",
    "",
    `_Generated by \`${scannerId}\` v${scannerVersion}. Ethereum-only defensive scanner._`,
    "",
  ].join("\n");
}
