"""Markdown + JSON research receipts (beside Lane A receipts)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from eth_scanner.receipt import redact_text
from eth_scanner.research import RESEARCH_STACK_VERSION
from eth_scanner.research.types import ResearchRun

STACK_ID = "eth-scanner-research"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _md_escape(text: Any) -> str:
    return ("" if text is None else str(text)).replace("|", "\\|").replace("\n", " ").strip()


def render_research_markdown(run: ResearchRun, *, generated_at: str = "") -> str:
    generated_at = generated_at or _now()
    ir = run.contract_ir
    flow = run.funds_flow
    lines: list[str] = [
        "# ETH research receipt",
        "",
        "> **Defensive report.** Findings are invariant / property / detector rows.",
        "> `defensive_only=true` on every finding. Do **not** write exploits, PoCs,",
        "> drain scripts, or live fund-moving transactions from this file.",
        "> Lane A remains the picker (buckets, never a verdict).",
        "",
        "## Identity",
        "",
        f"- **Stack:** `{STACK_ID}` v{RESEARCH_STACK_VERSION}",
        f"- **Generated (UTC):** {generated_at}",
        f"- **Address:** `{run.address}`",
        f"- **Lane A role / scope:** `{run.role}` / `{run.scope}`",
        f"- **Lane A bucket:** `{run.lane_a_bucket or '—'}`",
        f"- **Proceeded past L1 gate:** {'no' if run.gated else 'yes'} — {_md_escape(run.gate_reason)}",
        "",
        "## Layers",
        "",
        f"- **Ran:** {', '.join(run.layers_run) or '—'}",
        f"- **Skipped:** {', '.join('%s (%s)' % (s.layer, s.reason) for s in run.layers_skipped) or '—'}",
        "",
        "## L0 contract IR",
        "",
    ]
    if ir is None:
        lines.append("- not emitted (gated out or ingest failed)")
    else:
        lines += [
            f"- **Name:** `{_md_escape(ir.name) or '—'}`",
            f"- **Implementation:** `{ir.implementation or '—'}` ({ir.implementation_source or 'none'})",
            f"- **Diamond:** `{ir.diamond_status or '—'}` · facets listed: {len(ir.facets)}",
            f"- **ABI entries:** {len(ir.abi)} · **selectors:** {len(ir.selectors)}",
            f"- **Source paths:** {len(ir.source_paths)}",
            f"- **Storage layout:** {'present' if ir.storage_layout else 'unavailable'}",
        ]
        if ir.notes:
            lines.append("- **IR notes:**")
            for n in ir.notes:
                lines.append(f"  - {_md_escape(redact_text(n))}")
    lines += ["", "## L3 funds-flow / authority", ""]
    if flow is None:
        lines.append("- not built")
    else:
        lines.append(f"- **Summary:** {_md_escape(flow.summary)}")
        if flow.sinks:
            lines += [
                "",
                "| Function | Kind | Vis | Gating | Modifiers |",
                "| --- | --- | --- | --- | --- |",
            ]
            for s in flow.sinks[:40]:
                lines.append(
                    "| `%s` | `%s` | `%s` | `%s` | `%s` |"
                    % (
                        _md_escape(s.name),
                        _md_escape(s.kind),
                        _md_escape(s.visibility),
                        _md_escape(s.gating),
                        _md_escape(",".join(s.modifiers) or "—"),
                    )
                )
        else:
            lines.append("- no sinks recorded")
    lines += ["", "## Findings (defensive_only=true)", ""]
    if not run.findings:
        lines.append("- none")
    else:
        lines += [
            "| ID | Layer | Severity | Detector | Title |",
            "| --- | --- | --- | --- | --- |",
        ]
        for f in run.findings:
            lines.append(
                "| `%s` | `%s` | `%s` | `%s` | %s |"
                % (
                    _md_escape(f.id),
                    _md_escape(f.layer),
                    _md_escape(f.severity),
                    _md_escape(f.detector),
                    _md_escape(f.title),
                )
            )
        lines += ["", "### Evidence", ""]
        for f in run.findings:
            lines.append(f"- `{f.id}` — {_md_escape(redact_text(f.evidence))}")
    if run.invariant_paths:
        lines += ["", "## L4 invariant stubs", ""]
        for p in run.invariant_paths:
            lines.append(f"- `{_md_escape(p)}`")
    lines += ["", "## Notes", ""]
    if run.notes:
        for n in run.notes:
            lines.append(f"- {_md_escape(redact_text(n))}")
    else:
        lines.append("- none")
    lines += [
        "",
        "## Handoff",
        "",
        "1. Treat every row as a defensive report, not a disclosure and not a close.",
        "2. Do not write a PoC, exploit, local-fork theft sim, or live transaction.",
        "3. Re-run Lane A if the bucket / scope looks wrong; this stack does not replace the picker.",
        "",
        "---",
        "",
        f"_Generated by `{STACK_ID}` v{RESEARCH_STACK_VERSION}. Ethereum-only. Defensive._",
        "",
    ]
    return "\n".join(lines)


def receipt_stem(address: str, generated_at: str) -> str:
    ts = re.sub(r"[^0-9TZ]", "", generated_at)[:16] or "undated"
    addr = (address or "unknown").lower()
    return f"research-{addr}-{ts}"


def write_research_receipts(
    run: ResearchRun,
    *,
    dest_dir: Path,
    generated_at: Optional[str] = None,
) -> tuple[Path, Path]:
    generated_at = generated_at or _now()
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    stem = receipt_stem(run.address, generated_at)
    md_path = dest / f"{stem}.md"
    json_path = dest / f"{stem}.json"
    md_path.write_text(render_research_markdown(run, generated_at=generated_at), encoding="utf-8")
    payload = redact_text(run.to_dict())
    payload["generated_at"] = generated_at
    payload["stack"] = STACK_ID
    payload["stack_version"] = RESEARCH_STACK_VERSION
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    run.receipt_md_path = str(md_path)
    run.receipt_json_path = str(json_path)
    return md_path, json_path
