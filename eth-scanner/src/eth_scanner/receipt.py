"""Self-contained Markdown scan receipts.

User-facing download is Markdown only. Internal dicts exist so tests and
the triage API can rebuild the same document from a FunnelResult or a
stored row. Never embed API keys or other env secrets.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from eth_scanner import __version__
from eth_scanner.types import FunnelResult, SourceArtifact, Target, to_plain

SCANNER_ID = "eth-scanner"

# Automation routing labels — never a human verdict.
BUCKET_MEANING: dict[str, str] = {
    "lane-a-cool": "High/usable IR, movers gated or none. Archive with score trail; human spot-check.",
    "lane-b-queue": "S6 gate (heat / TVL / weirdness). Promoted to Lane B. Not a finding.",
    "manual-review": "Low/failed confidence or ambiguous cheap check. Do Not Auto-Dismiss.",
    "human-no-candidate": "High-confidence all-clear candidate. Human still stamps no.",
    "human-yes-candidate": "BROKEN hypothesis with a locus. Human stamps yes after path verify (no PoC).",
}

BUCKET_HUMAN_STAMP: dict[str, str] = {
    "lane-a-cool": "optional spot-check (not a close)",
    "lane-b-queue": "none yet — wait for Lane B",
    "manual-review": "required (needs-look). Do not stamp no from this bucket alone.",
    "human-no-candidate": "human stamps no",
    "human-yes-candidate": "human stamps yes only after reading the locus. Automation never stamps yes.",
}

_SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|user[_-]?key|service[_-]?role|secret|private[_-]?key|authorization|"
    r"access[_-]?token|refresh[_-]?token|password|mnemonic|seed[_-]?phrase|wallet[_-]?seed)",
    re.I,
)
_SECRET_VALUE_RE = re.compile(
    r"(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"  # JWT / service-role
    r"|(?:sk[_-][A-Za-z0-9]{16,})"
    r"|(?:Bearer\s+[A-Za-z0-9._\-]+)",
    re.I,
)

REQUIRED_HEADINGS = (
    "How to use this file",
    "Identity",
    "Contract",
    "Source provenance",
    "Lanes and stages",
    "Leads (not findings)",
    "Routing outcome (bucket, not a verdict)",
    "Confidence",
    "Notes",
    "Handoff for another AI",
)


@dataclass
class ReceiptContext:
    """Inputs for one receipt. Missing pieces become 'unavailable'."""

    address: str
    lane: str = "A"
    result: dict[str, Any] = field(default_factory=dict)
    artifact: dict[str, Any] = field(default_factory=dict)
    target: dict[str, Any] = field(default_factory=dict)
    generated_at: str = ""
    scanner_id: str = SCANNER_ID
    scanner_version: str = __version__
    worker_id: str = SCANNER_ID
    run_id: str = ""


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if is_dataclass(obj) and not isinstance(obj, type):
        return to_plain(obj)
    if isinstance(obj, dict):
        return dict(obj)
    return {}


def redact_text(value: Any) -> Any:
    """Strip secret-shaped keys/values. Receipts must never carry env secrets."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if _SECRET_KEY_RE.search(str(k)):
                out[str(k)] = "[redacted]"
            else:
                out[str(k)] = redact_text(v)
        return out
    if isinstance(value, (list, tuple)):
        return [redact_text(v) for v in value]
    if isinstance(value, str):
        text = _SECRET_VALUE_RE.sub("[redacted]", value)
        if _SECRET_KEY_RE.search(text) and "=" in text:
            text = _SECRET_KEY_RE.sub(lambda m: m.group(0), text)
            # "KEY=value" lines
            text = re.sub(
                r"(?i)((?:api[_-]?key|user[_-]?key|service[_-]?role|secret|token|password|mnemonic)[^\s=]*)\s*[:=]\s*\S+",
                r"\1=[redacted]",
                text,
            )
        return text
    return value


def _md_escape(text: Any) -> str:
    s = "" if text is None else str(text)
    return s.replace("|", "\\|").replace("\n", " ").strip()


def _fmt(value: Any, empty: str = "unavailable") -> str:
    if value is None or value == "" or value == []:
        return empty
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def _lanes_from_trace(stage_trace: list[Any], lane: str) -> list[str]:
    stages: list[str] = []
    for step in stage_trace:
        if isinstance(step, dict):
            stages.append(str(step.get("stage") or ""))
        else:
            stages.append(str(getattr(step, "stage", "") or ""))
    found: list[str] = []
    if any(s in {"S0", "S1", "S2", "S3", "S4", "S5", "S6"} for s in stages) or lane.upper() == "A":
        found.append("A")
    if any(s == "S7" for s in stages) or lane.upper() == "B":
        found.append("B")
    # Preserve order A then B, unique.
    out: list[str] = []
    for item in found:
        if item not in out:
            out.append(item)
    if not out:
        out.append(lane.upper() if lane else "A")
    return out


def infer_stages(stage_trace: list[Any]) -> list[str]:
    names: list[str] = []
    for step in stage_trace:
        name = step.get("stage") if isinstance(step, dict) else getattr(step, "stage", None)
        if name and name not in names:
            names.append(str(name))
    return names


def build_context(
    *,
    address: str,
    lane: str,
    result: FunnelResult | dict[str, Any] | None = None,
    artifact: SourceArtifact | dict[str, Any] | None = None,
    target: Target | dict[str, Any] | None = None,
    scanner_id: str = SCANNER_ID,
    scanner_version: str = __version__,
    worker_id: str = SCANNER_ID,
    generated_at: Optional[str] = None,
    run_id: str = "",
) -> ReceiptContext:
    return ReceiptContext(
        address=address,
        lane=(lane or "A").upper(),
        result=redact_text(_as_dict(result)),
        artifact=redact_text(_as_dict(artifact)),
        target=redact_text(_as_dict(target)),
        generated_at=generated_at or _now(),
        scanner_id=scanner_id,
        scanner_version=scanner_version,
        worker_id=worker_id,
        run_id=run_id,
    )


def render_markdown(ctx: ReceiptContext) -> str:
    """Human + AI readable receipt. Markdown is the downloadable format."""
    res = ctx.result
    art = ctx.artifact
    tgt = ctx.target
    stage_trace = list(res.get("stage_trace") or [])
    lanes = _lanes_from_trace(stage_trace, ctx.lane)
    stages = infer_stages(stage_trace)
    bucket = res.get("bucket")
    notes = res.get("notes") or []
    if isinstance(notes, str):
        note_lines = [ln for ln in notes.splitlines() if ln.strip()]
    else:
        note_lines = [str(n) for n in notes if n]
    leads = list(res.get("pattern_leads") or art.get("pattern_leads") or [])
    hyps = list(res.get("hypotheses") or [])
    movers = list(res.get("value_movers") or [])
    src_conf = res.get("src_confidence") or art.get("src_confidence") or tgt.get("src_confidence")
    ir_conf = res.get("ir_confidence") or tgt.get("ir_confidence")
    heat = res.get("heat") if res.get("heat") is not None else tgt.get("heat")
    tvl = tgt.get("tvl_usd")
    kind = art.get("kind") or ("decompile" if src_conf == "low" else "unavailable")
    tool = art.get("tool") or "unavailable"
    verified = art.get("verified_match") or "unavailable"

    lines: list[str] = [
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
        f"- **Scanner:** `{ctx.scanner_id}` v{ctx.scanner_version}",
        f"- **Worker id:** `{ctx.worker_id}`",
        f"- **Generated (UTC):** {ctx.generated_at}",
    ]
    if ctx.run_id:
        lines.append(f"- **Run id:** `{ctx.run_id}`")
    lines += [
        f"- **Lane requested:** Lane {ctx.lane}",
        f"- **Lanes evidenced:** {', '.join('Lane ' + x for x in lanes)}",
        f"- **Stages in trace:** {', '.join(stages) if stages else 'unavailable'}",
        "- **Chain:** `ethereum` (this environment is Ethereum-only)",
        "",
        "## Contract",
        "",
        f"- **Address:** `{ctx.address}`",
        f"- **Bytecode hash:** `{_fmt(tgt.get('bytecode_hash'))}`",
        f"- **TVL USD (override / stored):** {_fmt(tvl)}",
        f"- **Target status:** `{_fmt(tgt.get('status'))}`",
        f"- **Has code:** {_fmt(tgt.get('has_code'), empty='unknown')}",
        "",
        "## Source provenance",
        "",
        f"- **Kind:** `{_fmt(kind)}` — `source` = verified / local; `decompile` = hypothesis only",
        f"- **Tool:** `{_fmt(tool)}` (etherscan | local | heimdall | panoramix | store | none)",
        f"- **src_confidence:** `{_fmt(src_conf)}` — high exact verified · med partial · low decompile only",
        f"- **verified_match:** `{_fmt(verified)}`",
        f"- **Language:** `{_fmt(art.get('language'))}`",
        f"- **Compiler:** `{_fmt(art.get('compiler'))}`",
        f"- **Contract name:** `{_fmt(art.get('contract_name'))}`",
        f"- **Proxy:** {_fmt(art.get('is_proxy'), empty='no')} · **implementation:** `{_fmt(art.get('implementation'))}`",
    ]
    art_notes = art.get("notes") or []
    if isinstance(art_notes, str):
        art_notes = [art_notes]
    if art_notes:
        lines.append("- **Provenance notes:**")
        for n in art_notes:
            lines.append(f"  - {_md_escape(redact_text(n))}")
    lines += [
        "- Source body is omitted from this receipt. Low-confidence decompile is never proof.",
        "",
        "## Lanes and stages",
        "",
        "Lane A = S0–S6 cheap skim + gate. Lane B = S7 deep invariants (I1–I8 leads).",
        "",
        "| Stage | Decision | Reason | Extras |",
        "| --- | --- | --- | --- |",
    ]
    if not stage_trace:
        lines.append("| — | — | no stage_trace stored | |")
    for step in stage_trace:
        if isinstance(step, dict):
            stage = step.get("stage", "")
            decision = step.get("decision", "")
            reason = step.get("reason", "")
            extras = redact_text(step.get("extras") or {})
        else:
            stage = getattr(step, "stage", "")
            decision = getattr(step, "decision", "")
            reason = getattr(step, "reason", "")
            extras = redact_text(getattr(step, "extras", {}) or {})
        extra_s = ""
        if extras:
            extra_s = "`" + _md_escape(json.dumps(extras, sort_keys=True, default=str)) + "`"
        lines.append(
            f"| `{_md_escape(stage)}` | `{_md_escape(decision)}` | {_md_escape(reason)} | {extra_s} |"
        )

    lines += [
        "",
        "## Leads (not findings)",
        "",
        "Every row below is a **lead for manual reading**. Grep / heuristic hits never qualify as `yes`.",
        "",
        "### Exposed value movers",
        "",
    ]
    if movers:
        for name in movers:
            lines.append(f"- `{_md_escape(name)}`")
    else:
        lines.append("- none recorded")

    lines += ["", "### Pattern skim (S3)", ""]
    if leads:
        for lead in leads:
            if isinstance(lead, dict):
                lid = lead.get("id") or lead.get("name") or "lead"
                detail = lead.get("detail") or lead.get("text") or lead.get("note") or ""
                lines.append(f"- `{_md_escape(lid)}` — {_md_escape(detail) or 'see extras'} *(lead only)*")
            else:
                lines.append(f"- {_md_escape(lead)} *(lead only)*")
    else:
        lines.append("- none recorded")

    lines += ["", "### Hypotheses (I1–I8 stubs)", ""]
    if hyps:
        lines += [
            "| Invariant | Status | Score | Locus | Text |",
            "| --- | --- | --- | --- | --- |",
        ]
        for h in hyps:
            if not isinstance(h, dict):
                h = _as_dict(h)
            lines.append(
                "| `{inv}` | `{st}` | {sc} | `{loc}` | {tx} |".format(
                    inv=_md_escape(h.get("invariant")),
                    st=_md_escape(h.get("status") or "OPEN"),
                    sc=_md_escape(h.get("score") if h.get("score") is not None else "—"),
                    loc=_md_escape(h.get("locus") or "—"),
                    tx=_md_escape(h.get("text") or h.get("notes") or ""),
                )
            )
        lines.append("")
        lines.append(
            "Status `BROKEN` on this receipt is only a **human-injected locus** routed to "
            "`human-yes-candidate`. Automation itself emits OPEN / HOLDS-shaped leads."
        )
    else:
        lines.append("- none (Lane A often has no I1–I8 stubs; Lane B adds them).")

    meaning = BUCKET_MEANING.get(str(bucket), "Unknown / dropped before a bucket.")
    stamp = BUCKET_HUMAN_STAMP.get(str(bucket), "human decides; automation does not")
    lines += [
        "",
        "## Routing outcome (bucket, not a verdict)",
        "",
        f"- **Bucket:** `{_fmt(bucket, empty='(none — dropped before routing)')}`",
        f"- **What that means:** {meaning}",
        f"- **Human stamp:** {stamp}",
        f"- **Dropped:** {_fmt(res.get('dropped'), empty='no')}"
        + (f" — `{_md_escape(res.get('drop_reason'))}`" if res.get("drop_reason") else ""),
        f"- **Heat (ranking only, never a dismiss):** {_fmt(heat, empty='0')}",
        "",
        "Automation **never** stamps `yes` or `no`. `human-*-candidate` still needs a human.",
        "Low or failed IR → `manual-review` (Do Not Auto-Dismiss).",
        "",
        "## Confidence",
        "",
        f"- **src_confidence:** `{_fmt(src_conf)}`",
        f"- **ir_confidence:** `{_fmt(ir_conf)}`",
        "- Scale: `high` Slither SSA / exact verified · `med` heuristic/Vyper / partial · "
        "`low` decompile or failed lift",
        "- Heimdall / Panoramix decompiles are hypothesis generators only (`src_confidence=low`).",
        "",
        "## Notes",
        "",
    ]
    if note_lines:
        for n in note_lines:
            lines.append(f"- {_md_escape(redact_text(n))}")
    else:
        lines.append("- none recorded")

    next_step = _handoff_next(bucket, src_conf, ir_conf)
    lines += [
        "",
        "## Handoff for another AI",
        "",
        "Continue from this receipt without the repo. Suggested posture:",
        "",
        "1. Treat the **bucket** as routing, not disclosure and not a close.",
        "2. Treat every heuristic / pattern / mover as a **lead**. Inventory paths in prose.",
        "3. If `ir_confidence` or `src_confidence` is `low`, or the bucket is `manual-review`, "
        "do **not** auto-dismiss. Read or escalate.",
        "4. If the bucket is `human-yes-candidate`, verify the locus by reading. "
        "**Do not** write a PoC, exploit, local-fork theft sim, or live transaction.",
        "5. If the bucket is `human-no-candidate`, a human still stamps `no`.",
        "",
        f"**Suggested next:** {next_step}",
        "",
        "---",
        "",
        f"_Generated by `{ctx.scanner_id}` v{ctx.scanner_version}. Ethereum-only defensive scanner._",
        "",
    ]
    return "\n".join(lines)


def _handoff_next(bucket: Any, src_conf: Any, ir_conf: Any) -> str:
    if bucket == "manual-review" or src_conf == "low" or ir_conf == "low":
        return (
            "Manual read of movers + provenance. Do not close as no. "
            "If source is missing, fetch verified Etherscan or local `--source` and re-run Lane A."
        )
    if bucket == "lane-b-queue":
        return "Run Lane B (`python -m eth_scanner lane-b --address <addr>`) then re-download this receipt."
    if bucket == "human-yes-candidate":
        return "Human path-verify the locus in prose. Stamp yes only after that. No PoC."
    if bucket == "human-no-candidate":
        return "Human stamps no if the all-clear still holds after a spot check."
    if bucket == "lane-a-cool":
        return "Optional human spot-check of the score trail. Not a silent close."
    if not bucket:
        return "Intake dropped (EOA / non-ETH / closed-no duplicate). No bucket to stamp."
    return "Re-read notes + stage_trace and decide a human stamp."


def default_receipt_dir(work_dir: Path) -> Path:
    return Path(work_dir) / "receipts"


def receipt_filename(address: str, lane: str, generated_at: str) -> str:
    ts = re.sub(r"[^0-9TZ]", "", generated_at)[:16] or "undated"
    addr = (address or "unknown").lower()
    return f"receipt-{addr}-lane-{lane.lower()}-{ts}.md"


def write_markdown(
    markdown: str,
    *,
    dest_dir: Optional[Path] = None,
    dest_file: Optional[Path] = None,
    address: str = "",
    lane: str = "A",
    generated_at: Optional[str] = None,
) -> Path:
    if dest_file is not None:
        path = Path(dest_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding="utf-8")
        return path
    if dest_dir is None:
        raise ValueError("write_markdown needs dest_dir or dest_file")
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / receipt_filename(address, lane, generated_at or _now())
    path.write_text(markdown, encoding="utf-8")
    return path


def write_run_receipt(
    *,
    address: str,
    lane: str,
    result: FunnelResult | dict[str, Any] | None,
    artifact: SourceArtifact | dict[str, Any] | None = None,
    target: Target | dict[str, Any] | None = None,
    dest_dir: Optional[Path] = None,
    dest_file: Optional[Path] = None,
    scanner_id: str = SCANNER_ID,
    scanner_version: str = __version__,
    worker_id: str = SCANNER_ID,
    run_id: str = "",
) -> Path:
    ctx = build_context(
        address=address,
        lane=lane,
        result=result,
        artifact=artifact,
        target=target,
        scanner_id=scanner_id,
        scanner_version=scanner_version,
        worker_id=worker_id,
        run_id=run_id,
    )
    md = render_markdown(ctx)
    return write_markdown(
        md,
        dest_dir=dest_dir,
        dest_file=dest_file,
        address=address,
        lane=ctx.lane,
        generated_at=ctx.generated_at,
    )


def pick_source_artifact(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Prefer a stored source/decompile payload (not IR / report)."""
    sources = [a for a in artifacts if a.get("kind") == "source"]
    decomps = [a for a in artifacts if a.get("kind") == "decompile"]
    pool = sources or decomps
    pool.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    if not pool:
        return {}
    row = pool[0]
    payload = row.get("path_or_json")
    if isinstance(payload, dict):
        merged = dict(payload)
        merged.setdefault("kind", row.get("kind"))
        merged.setdefault("src_confidence", row.get("confidence"))
        # Never dump full source into a receipt context via this helper.
        merged.pop("content", None)
        return merged
    return {"kind": row.get("kind"), "src_confidence": row.get("confidence")}
