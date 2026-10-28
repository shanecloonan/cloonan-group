"""L4/L5 symbolic / formal hooks (Halmos, hevm).

Read-only property checks when the CLI is on PATH. Missing tools skip
with a receipt note — never a hard fail. No exploit synthesis.

Documented commands (also in research/README.md):

    # Halmos — check_* view properties in the packaged fuzz project
    halmos --function check_ --solver-timeout-assertion 2000

    # hevm — symbolic execution of a view signature against deployed bytecode
    hevm symbolic --code <deployed-bytecode-hex> --sig "totalAssets()" --smttimeout 5000
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from eth_scanner.research.types import Finding, LayerSkip

HALMOS_CMD_DOC = "halmos --function check_ --solver-timeout-assertion 2000"
HEVM_CMD_DOC = 'hevm symbolic --code <deployed-bytecode-hex> --sig "totalAssets()" --smttimeout 5000'


def halmos_available() -> bool:
    return bool(shutil.which("halmos"))


def hevm_available() -> bool:
    return bool(shutil.which("hevm"))


def _tail(text: str, n: int = 6) -> str:
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    return " | ".join(ln.strip()[:160] for ln in lines[-n:])


def run_halmos(
    project_dir: Path,
    *,
    timeout_s: int = 90,
) -> tuple[Optional[int], str]:
    if not halmos_available():
        return None, "halmos not on PATH — L4 symbolic skipped (install: pipx install halmos). Command: %s" % HALMOS_CMD_DOC
    root = Path(project_dir)
    if not (root / "foundry.toml").is_file():
        return None, "no foundry.toml for halmos — skipped. Command: %s" % HALMOS_CMD_DOC
    try:
        proc = subprocess.run(
            ["halmos", "--function", "check_", "--solver-timeout-assertion", "2000"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None, "halmos timed out after %ss. Command: %s" % (timeout_s, HALMOS_CMD_DOC)
    except OSError as exc:
        return None, "halmos failed to start: %s. Command: %s" % (exc, HALMOS_CMD_DOC)
    note = "halmos --function check_ exit=%s" % proc.returncode
    tail = _tail((proc.stdout or "") + "\n" + (proc.stderr or ""))
    if tail:
        note += " — " + tail[:240]
    return proc.returncode, note


def _find_deployed_bytecode(project_dir: Path) -> Optional[str]:
    out = Path(project_dir) / "out"
    if not out.is_dir():
        return None
    for path in sorted(out.rglob("*.json")):
        if path.name.startswith(".") or "build-info" in path.parts:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        deployed = ""
        if isinstance(payload, dict):
            inner = payload.get("deployedBytecode")
            if isinstance(inner, dict):
                deployed = str(inner.get("object") or "")
            elif isinstance(inner, str):
                deployed = inner
        if deployed.startswith("0x") and len(deployed) > 10:
            return deployed
    return None


def run_hevm(
    project_dir: Path,
    *,
    timeout_s: int = 60,
) -> tuple[Optional[int], str]:
    if not hevm_available():
        return None, "hevm not on PATH — L5 symbolic skipped. Command: %s" % HEVM_CMD_DOC
    root = Path(project_dir)
    code = _find_deployed_bytecode(root)
    if not code:
        return None, (
            "hevm present but no compiled bytecode under out/ "
            "(run forge test first, or compile). Command: %s" % HEVM_CMD_DOC
        )
    try:
        proc = subprocess.run(
            ["hevm", "symbolic", "--code", code, "--sig", "totalAssets()", "--smttimeout", "5000"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None, "hevm symbolic timed out after %ss. Command: %s" % (timeout_s, HEVM_CMD_DOC)
    except OSError as exc:
        return None, "hevm failed to start: %s. Command: %s" % (exc, HEVM_CMD_DOC)
    note = "hevm symbolic --sig totalAssets() exit=%s" % proc.returncode
    tail = _tail((proc.stdout or "") + "\n" + (proc.stderr or ""))
    if tail:
        note += " — " + tail[:240]
    return proc.returncode, note


def run_symbolic_layer(
    *,
    address: str,
    project_dir: Optional[Path],
    try_halmos: bool = True,
    try_hevm: bool = True,
) -> tuple[list[Finding], list[LayerSkip], list[str]]:
    findings: list[Finding] = []
    skips: list[LayerSkip] = []
    notes: list[str] = []
    dest = Path(project_dir) if project_dir else None

    if try_halmos:
        if dest is None:
            note = "halmos skipped — no fuzz project dir. Command: %s" % HALMOS_CMD_DOC
            rc = None
        else:
            rc, note = run_halmos(dest)
        notes.append(note)
        skipped = rc is None
        findings.append(Finding(
            id="L4-halmos-1",
            severity="info",
            layer="L4",
            title="Halmos %s" % ("skipped" if skipped else "ran"),
            evidence=note,
            address=address,
            detector="symbolic:halmos",
        ))
        if skipped:
            skips.append(LayerSkip(layer="L4", reason=note))
    else:
        notes.append("halmos disabled by flag")

    if try_hevm:
        if dest is None:
            note = "hevm skipped — no fuzz project dir. Command: %s" % HEVM_CMD_DOC
            rc = None
        else:
            rc, note = run_hevm(dest)
        notes.append(note)
        skipped = rc is None
        findings.append(Finding(
            id="L5-hevm-1",
            severity="info",
            layer="L5",
            title="hevm %s" % ("skipped" if skipped else "ran"),
            evidence=note,
            address=address,
            detector="symbolic:hevm",
        ))
        if skipped:
            skips.append(LayerSkip(layer="L5", reason=note))
    else:
        notes.append("hevm disabled by flag")

    return findings, skips, notes
