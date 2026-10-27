"""Normalize verified source or decompile text into a thin IR document.

Slither-class SSA is used when the `slither` CLI is present and the
source is verified Solidity (`ir_confidence=high`). Otherwise:

- verified Solidity / Vyper → heuristic CFG (`med`)
- decompile / failed lift → `low` (never treated as proof)

`ir_confidence` is always set. Weak IR cannot claim yes or auto-no.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

from eth_scanner.heuristics.invariant_pass import run_scan, run_scan_source
from eth_scanner.heuristics.patterns import detect_fork_family, detect_weird_signals, skim_known_patterns
from eth_scanner.types import FunctionIR, IRDocument, SourceArtifact


def normalize(
    artifact: SourceArtifact,
    source_dir: Optional[Path] = None,
    try_slither: bool = True,
) -> IRDocument:
    notes: list[str] = []
    src = artifact.content or ""
    language = artifact.language or _guess_lang(artifact)
    src_conf = artifact.src_confidence

    surface: dict[str, Any]
    lift_failed = False
    if source_dir and source_dir.exists():
        try:
            surface = run_scan([str(source_dir)])
        except Exception as exc:  # noqa: BLE001 — lift failure is a first-class outcome
            lift_failed = True
            surface = {"error": str(exc), "files": [], "summary": {}}
            notes.append("heuristic lift from directory failed: %s" % exc)
    elif src.strip():
        filename = "Contract.vy" if language == "vyper" else "Contract.sol"
        try:
            surface = run_scan_source(src, filename=filename, language=language)
        except Exception as exc:  # noqa: BLE001
            lift_failed = True
            surface = {"error": str(exc), "files": [], "summary": {}}
            notes.append("heuristic lift from source string failed: %s" % exc)
    else:
        lift_failed = True
        surface = {"error": "empty source", "files": [], "summary": {}}
        notes.append("no source or decompile text to lift")

    functions = _functions_from_surface(surface)
    if not lift_failed and not functions and not src.strip():
        lift_failed = True

    slither_ok = False
    if try_slither and src_conf == "high" and language == "solidity" and not lift_failed:
        slither_ok = _try_slither(src, source_dir)
        if slither_ok:
            notes.append("slither CLI present; treating verified Solidity as high-confidence IR")
        else:
            notes.append("slither CLI missing or failed — heuristic IR only (med)")

    ir_conf = _ir_confidence(
        src_conf=src_conf,
        language=language,
        lift_failed=lift_failed,
        slither_ok=slither_ok,
        kind=artifact.kind,
    )
    if lift_failed:
        ir_conf = "low"
        notes.append("IR lift failed → ir_confidence=low → manual-review (Do Not Auto-Dismiss)")

    weird = detect_weird_signals(src)
    fork = detect_fork_family(src)
    leads = skim_known_patterns(src)
    accounting: list[dict[str, Any]] = []
    ext: list[dict[str, Any]] = []
    for f in surface.get("files") or []:
        accounting.extend(f.get("accounting") or [])
        ext.extend(f.get("external_calls") or [])

    if artifact.kind == "decompile":
        notes.append("Decompile is a hypothesis generator only. Never proof of safety or theft.")

    return IRDocument(
        functions=functions,
        ir_confidence=ir_conf,
        src_confidence=src_conf,
        language=language,
        lift_failed=lift_failed,
        lift_tool="slither" if slither_ok else "heuristic",
        notes=notes,
        surface=surface,
        weird_signals=weird,
        pattern_leads=leads,
        accounting_hits=accounting,
        external_calls=ext,
        abi_mismatch_hint=bool(artifact.is_proxy and not artifact.implementation),
        fork_family=fork,
    )


def _guess_lang(artifact: SourceArtifact) -> str:
    if artifact.language in ("solidity", "vyper"):
        return artifact.language
    if (artifact.compiler or "").lower().startswith("vyper"):
        return "vyper"
    return "solidity"


def _functions_from_surface(surface: dict[str, Any]) -> list[FunctionIR]:
    out: list[FunctionIR] = []
    for f in surface.get("files") or []:
        fname = f.get("file") or ""
        for m in f.get("fund_movers") or []:
            vis = m.get("visibility") or ""
            exposed = vis in ("external", "public")
            out.append(FunctionIR(
                name=m.get("fn") or "unknown",
                visibility=vis,
                line=int(m.get("line") or 0),
                end=int(m.get("end") or 0),
                file=fname,
                fund_signals=list(m.get("fund_signals") or []),
                auth_signals=list(m.get("auth_signals") or []),
                auth_heuristic=m.get("auth_heuristic") or "AMBIGUOUS",
                accounting_touched=list(m.get("accounting_touched") or []),
                is_value_mover=True,
                exposed=exposed,
            ))
    return out


def _ir_confidence(*, src_conf: str, language: str, lift_failed: bool, slither_ok: bool, kind: str) -> str:
    if lift_failed or kind == "decompile" or src_conf == "low":
        return "low"
    if slither_ok and language == "solidity" and src_conf == "high":
        return "high"
    return "med"


def _try_slither(src: str, source_dir: Optional[Path]) -> bool:
    if not shutil.which("slither"):
        return False
    try:
        if source_dir and source_dir.exists():
            target = str(source_dir)
            proc = subprocess.run(
                ["slither", target, "--print", "human-summary", "--json", "-"],
                capture_output=True, text=True, timeout=60, check=False,
            )
            return proc.returncode == 0 or bool(proc.stdout.strip())
        with tempfile.TemporaryDirectory(prefix="eth-scanner-slither-") as tmp:
            p = Path(tmp) / "Contract.sol"
            p.write_text(src, encoding="utf-8")
            proc = subprocess.run(
                ["slither", str(p), "--print", "human-summary", "--json", "-"],
                capture_output=True, text=True, timeout=60, check=False,
            )
            if proc.returncode == 0:
                return True
            # Slither often exits non-zero on findings; JSON on stdout still means a lift.
            try:
                json.loads(proc.stdout or "{}")
                return True
            except json.JSONDecodeError:
                return False
    except (OSError, subprocess.TimeoutExpired):
        return False
