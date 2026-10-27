#!/usr/bin/env python3
"""Read-only ETH surface report (fund movers, auth, accounting, extcalls).

Port of the factory `invariant_pass.py` helper, scoped to Solidity / Vyper
for this Ethereum-only environment.

SAFETY: local static text analysis only. No network, no RPC, no
transactions, no exploit or PoC generation. Every flag is a LEAD for
manual reading, never a finding.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

SKIP_DIRS = {
    ".git", "node_modules", "target", "out", "cache", "artifacts",
    "build", "lib", "__pycache__", ".venv", "venv", "dist", "typechain",
    "typechain-types", "coverage",
}
TEST_HINT = re.compile(r"(^|/)(test|tests|mock|mocks|script|scripts)(/|$)|\.t\.sol$|_test\.|test_", re.I)
EXT_LANG = {".sol": "solidity", ".vy": "vyper"}
ABI_HINT = re.compile(r"(abi|idl)", re.I)

FUND = {
    "solidity": [
        r"\.transfer\s*\(", r"\.transferFrom\s*\(", r"safeTransfer(From)?\s*\(",
        r"\.send\s*\(", r"\.call\s*\{\s*value", r"\b_mint\s*\(", r"\b_burn\s*\(",
        r"\bmint\s*\(", r"\bburn\s*\(", r"selfdestruct\s*\(", r"\.withdraw\s*\(",
        r"\.deposit\s*\(", r"\.borrow\s*\(", r"\.repay\s*\(", r"\.swap\s*\(",
        r"\.flashLoan\s*\(", r"\bsafeApprove\s*\(|\.approve\s*\(",
    ],
    "vyper": [
        r"\bsend\s*\(", r"raw_call\s*\(", r"\.transfer\s*\(", r"\.transferFrom\s*\(",
        r"\b_mint\s*\(", r"\b_burn\s*\(", r"selfdestruct\s*\(",
    ],
}
FUND_NAME = re.compile(
    r"(transfer|withdraw|redeem|mint|burn|borrow|repay|liquidat|swap|claim|"
    r"harvest|flash|sweep|rescue|skim|exit|unstake|release|bridge|payout|"
    r"collect|refund|settle|execute)",
    re.I,
)
AUTH = {
    "solidity": [
        r"\bonly[A-Z]\w*", r"require\s*\([^;]*msg\.sender", r"msg\.sender\s*[!=]=",
        r"_checkOwner|_checkRole|hasRole\s*\(|_msgSender\(\)\s*[!=]=",
        r"\bauth\b|\brequiresAuth\b",
        r"ecrecover\s*\(|ECDSA\.recover|SignatureChecker|isValidSignature",
        r"\binitializer\b|\breinitializer\b|\bwhenNotPaused\b",
        r"if\s*\([^)]*msg\.sender[^)]*\)\s*revert", r"MerkleProof\.verify",
    ],
    "vyper": [r"assert\s+msg\.sender", r"msg\.sender\s*[!=]="],
}
ACCT = re.compile(
    r"\b(totalSupply|total_supply|totalAssets|total_assets|totalShares|total_shares|"
    r"shares?\b|exchangeRate\w*|exchange_rate\w*|pricePerShare|price_per_share|"
    r"convertTo(Shares|Assets)|preview(Deposit|Mint|Withdraw|Redeem)|"
    r"reserves?\d?\b|getReserves|_reserve\w*|totalBorrows?|total_borrow\w*|totalDebt|"
    r"borrowIndex|supplyIndex|reward(PerToken|_per_token|Index|_index)\w*|"
    r"accRewardPerShare|acc_\w*_per_share|cumulative\w*|virtual_?\w*price|"
    r"balanceOf\s*\(\s*address\s*\(\s*this\s*\)\s*\)|feeGrowth\w*|protocolFee\w*|"
    r"liquidity\b|sqrtPrice\w*|slot0)\b"
)
EXT = {
    "solidity": [
        (r"\.call\s*[\({]", "low-level call"),
        (r"\.delegatecall\s*\(", "delegatecall"),
        (r"\.staticcall\s*\(", "staticcall"),
        (r"\.send\s*\(", "send"),
        (r"assembly\s*\{", "inline assembly"),
        (r"\bI[A-Z]\w*\s*\([^)]*\)\s*\.\s*\w+\s*\(", "interface call"),
    ],
    "vyper": [(r"raw_call\s*\(", "raw_call"), (r"extcall\s+", "extcall")],
}


def strip_comments(src: str, lang: str) -> str:
    """Blank out comments and string literals, preserving offsets/newlines."""
    out, i, n = list(src), 0, len(src)

    def blank(a: int, b: int) -> None:
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        c = src[i]
        if lang == "vyper" and c == "#":
            j = src.find("\n", i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
            continue
        if c == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            blank(i + 1, min(j, n))
            i = j + 1
            continue
        i += 1
    return "".join(out)


def match_brace(s: str, start: int) -> int:
    depth = 0
    for k in range(start, len(s)):
        if s[k] == "{":
            depth += 1
        elif s[k] == "}":
            depth -= 1
            if depth == 0:
                return k
    return len(s) - 1


FN_RE = {
    "solidity": re.compile(r"\b(function\s+(\w+)|(constructor|receive|fallback))\s*\(", re.M),
}


def visibility(lang: str, header: str, _pre: str) -> str:
    if lang == "solidity":
        v = next(
            (x for x in ("external", "public", "internal", "private") if re.search(r"\b%s\b" % x, header)),
            "public",
        )
        if re.search(r"\b(view|pure)\b", header):
            v += " view"
        if re.search(r"\b(constructor)\b", header):
            v = "constructor"
        return v
    return "?"


def functions(src: str, clean: str, lang: str) -> list[dict[str, Any]]:
    fns: list[dict[str, Any]] = []
    if lang == "vyper":
        lines = clean.split("\n")
        for idx, line in enumerate(lines):
            m = re.match(r"def\s+(\w+)\s*\(", line)
            if not m:
                continue
            decos, k = [], idx - 1
            while k >= 0 and lines[k].strip().startswith("@"):
                decos.append(lines[k].strip())
                k -= 1
            end = idx + 1
            while end < len(lines) and (not lines[end].strip() or lines[end].startswith((" ", "\t"))):
                end += 1
            body = "\n".join(lines[idx:end])
            header = " ".join(decos) + " " + line
            vis = "external" if "@external" in header else "internal"
            if "@view" in header or "@pure" in header:
                vis += " view"
            fns.append(dict(name=m.group(1), line=idx + 1, end=end, header=header, body=body, vis=vis))
        return fns
    rx = FN_RE["solidity"]
    for m in rx.finditer(clean):
        name = m.group(2) or m.group(3)
        brace, semi = clean.find("{", m.end()), clean.find(";", m.end())
        if brace < 0 or (0 <= semi < brace):
            continue
        line_start = clean.rfind("\n", 0, m.start()) + 1
        pre = clean[max(0, line_start - 400):line_start]
        header = clean[line_start:brace]
        end = match_brace(clean, brace)
        body = clean[brace:end + 1]
        vis = visibility(lang, header, pre)
        fns.append(dict(
            name=name,
            line=clean.count("\n", 0, m.start()) + 1,
            end=clean.count("\n", 0, end) + 1,
            header=header,
            body=body,
            vis=vis,
            pre=pre,
        ))
    return fns


def solidity_modifiers(clean: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in re.finditer(r"\bmodifier\s+(\w+)", clean):
        b = clean.find("{", m.end())
        if b < 0:
            continue
        out[m.group(1)] = clean[b:match_brace(clean, b) + 1]
    return out


def hits(patterns: list[str], text: str) -> list[str]:
    found: list[str] = []
    for p in patterns:
        for m in re.finditer(p, text):
            found.append(m.group(0).strip()[:60])
    return sorted(set(found))


def analyse_file(path: str, rel: str) -> dict[str, Any]:
    lang = EXT_LANG[os.path.splitext(path)[1]]
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            src = fh.read()
    except OSError as e:
        return dict(file=rel, lang=lang, error=str(e))
    return analyse_source(src, rel, lang)


def analyse_source(src: str, rel: str, lang: str) -> dict[str, Any]:
    clean = strip_comments(src, lang)
    mods = solidity_modifiers(clean) if lang == "solidity" else {}
    fund_p = FUND.get(lang, [])
    auth_p = AUTH.get(lang, [])
    res: dict[str, Any] = dict(file=rel, lang=lang, fund_movers=[], accounting=[], external_calls=[], functions=0)
    for fn in functions(src, clean, lang):
        res["functions"] += 1
        body = fn["body"]
        f_hits = hits(fund_p, body)
        name_hit = bool(FUND_NAME.search(fn["name"]))
        view = "view" in fn["vis"]
        if (f_hits or (name_hit and not view)) and fn["vis"] != "constructor":
            ctx = fn["header"] + body
            if lang == "solidity":
                for mname, mbody in mods.items():
                    if re.search(r"\b%s\b" % mname, fn["header"]):
                        ctx += mbody
            a_hits = hits(auth_p, ctx)
            exposed = fn["vis"] in ("external", "public")
            if a_hits:
                strength = "PRESENT"
                if len(a_hits) == 1 and re.match(
                    r"(seeds|constraint|address|\binitializer|whenNotPaused|owner\s*=)",
                    a_hits[0],
                ):
                    strength = "WEAK"
            elif re.search(r"msg\.sender|_msgSender\(\)", body):
                strength = "SELF-SCOPED?"
            else:
                strength = "MISSING" if exposed else "MISSING(internal — check callers)"
            res["fund_movers"].append(dict(
                fn=fn["name"],
                line=fn["line"],
                end=fn["end"],
                visibility=fn["vis"],
                fund_signals=f_hits or ["(name only: %s)" % fn["name"]],
                auth_signals=a_hits,
                auth_heuristic=strength,
                accounting_touched=sorted(set(m.group(0) for m in ACCT.finditer(body)))[:12],
            ))
    lines = clean.split("\n")
    src_lines = src.split("\n")
    for i, line in enumerate(lines, 1):
        for m in ACCT.finditer(line):
            text = src_lines[i - 1].strip()[:120] if i - 1 < len(src_lines) else ""
            res["accounting"].append(dict(line=i, term=m.group(0), text=text))
        for p, label in EXT.get(lang, []):
            if re.search(p, line):
                unchecked = False
                raw = src_lines[i - 1] if i - 1 < len(src_lines) else ""
                if lang == "solidity" and label in ("low-level call", "send", "delegatecall"):
                    unchecked = not re.search(
                        r"(\(\s*bool\s+\w+|\bbool\s+\w+\s*,|=\s*[^;]*\.(call|send|delegatecall)|require\s*\(|if\s*\(\s*!?",
                        line,
                    )
                if lang == "vyper" and label == "raw_call":
                    unchecked = "revert_on_failure=False" in raw
                res["external_calls"].append(dict(
                    line=i, kind=label, unchecked=unchecked, text=raw.strip()[:120],
                ))
    return res


def collect(paths: list[str], include_tests: bool) -> tuple[list[tuple[str, str]], list[str]]:
    files: list[tuple[str, str]] = []
    abis: list[str] = []
    for p in paths:
        p = os.path.abspath(p)
        if os.path.isfile(p):
            if os.path.splitext(p)[1] in EXT_LANG:
                files.append((p, os.path.basename(p)))
            elif p.endswith(".json") and ABI_HINT.search(os.path.basename(p)):
                abis.append(os.path.basename(p))
            continue
        if not os.path.isdir(p):
            continue
        for root, dirs, fs in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in fs:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, p)
                if f.endswith(".json") and (ABI_HINT.search(rel) or root.endswith(("idl", "abi", "abis"))):
                    abis.append(rel)
                ext = os.path.splitext(f)[1]
                if ext in EXT_LANG and (include_tests or not TEST_HINT.search(rel.replace(os.sep, "/"))):
                    files.append((full, rel))
            if len(files) > 5000:
                break
    return files, sorted(set(abis))


def summarise(reps: list[dict[str, Any]], inputs: list[str], abis: list[str]) -> dict[str, Any]:
    fm = [x for r in reps for x in r.get("fund_movers", [])]
    ex = [x for r in reps for x in r.get("external_calls", [])]
    return dict(
        inputs=inputs,
        abi_idl_files=abis,
        files=reps,
        summary=dict(
            files=len(reps),
            functions=sum(r.get("functions", 0) for r in reps),
            fund_movers=len(fm),
            auth_missing=sum(1 for x in fm if str(x.get("auth_heuristic", "")).startswith("MISSING")),
            auth_weak=sum(1 for x in fm if x.get("auth_heuristic") == "WEAK"),
            accounting_hits=sum(len(r.get("accounting", [])) for r in reps),
            external_calls=len(ex),
            unchecked_calls=sum(1 for x in ex if x.get("unchecked")),
        ),
    )


def run_scan(
    paths: list[str],
    include_tests: bool = False,
    address: str | None = None,
    chain: str | None = None,
) -> dict[str, Any]:
    """Library API — same payload as the original CLI --json output."""
    files, abis = collect(paths, include_tests)
    reps = [analyse_file(f, r) for f, r in files]
    rep = summarise(reps, paths, abis)
    if address or chain:
        rep["target"] = dict(
            chain=chain,
            address=address,
            manual_lookups=[
                "`eth_getCode` at %s — empty => not a contract" % (address or "<address>"),
                "EIP-1967 impl/admin/beacon slots via `eth_getStorageAt` — read the implementation",
                "Explorer / Sourcify verified source match vs local tree",
                "Owner / roles / timelock via view calls (`eth_call` only)",
            ],
        )
    return rep


def run_scan_source(src: str, filename: str = "Contract.sol", language: str = "solidity") -> dict[str, Any]:
    """Analyse a single in-memory source string (tests / ingest)."""
    lang = "vyper" if language == "vyper" or filename.endswith(".vy") else "solidity"
    reps = [analyse_source(src, filename, lang)]
    return summarise(reps, [filename], [])


def render_md(rep: dict[str, Any]) -> str:
    o = ["# Invariant surface report (HEURISTIC — leads, not findings)", ""]
    o.append("- Input: `%s`" % "`, `".join(rep["inputs"]))
    if rep.get("target"):
        o.append("- Target: chain=`%s` address=`%s`" % (
            rep["target"].get("chain") or "UNKNOWN",
            rep["target"].get("address") or "UNKNOWN",
        ))
    s = rep["summary"]
    o.append(
        "- Files: %d | functions: %d | fund movers: %d (auth MISSING: %d, WEAK: %d) | "
        "accounting hits: %d | external sites: %d (unchecked: %d)"
        % (
            s["files"], s["functions"], s["fund_movers"], s["auth_missing"], s["auth_weak"],
            s["accounting_hits"], s["external_calls"], s["unchecked_calls"],
        )
    )
    o += [
        "",
        "> Auth strength is keyword proximity only. Confirm by reading. Never a finding.",
        "",
        "## 1. Fund movers (I1)",
        "",
        "| file:line | fn | vis | auth (heuristic) | fund signals | auth signals | accounting |",
        "|---|---|---|---|---|---|---|",
    ]
    order = {"MISSING": 0, "MISSING(internal — check callers)": 1, "WEAK": 2, "SELF-SCOPED?": 3, "PRESENT": 4}
    fm = [(f["file"], x) for f in rep["files"] for x in f.get("fund_movers", [])]
    fm.sort(key=lambda t: (order.get(t[1]["auth_heuristic"], 9), t[0], t[1]["line"]))
    for fname, x in fm:
        o.append("| `%s:%d` | `%s` | %s | **%s** | %s | %s | %s |" % (
            fname, x["line"], x["fn"], x["visibility"], x["auth_heuristic"],
            ", ".join("`%s`" % h for h in x["fund_signals"][:5]),
            ", ".join("`%s`" % h for h in x["auth_signals"][:4]) or "—",
            ", ".join("`%s`" % h for h in x["accounting_touched"][:6]) or "—",
        ))
    o += ["", "## 2. Accounting hotspots (I2 / I7)", ""]
    for f in rep["files"]:
        acc = f.get("accounting", [])
        if not acc:
            continue
        terms: dict[str, list[int]] = {}
        for a in acc:
            terms.setdefault(a["term"], []).append(a["line"])
        o.append("- `%s`: " % f["file"] + "; ".join(
            "`%s` L%s" % (t, ",".join(map(str, ls[:8])) + ("…" if len(ls) > 8 else ""))
            for t, ls in sorted(terms.items())
        ))
    o += ["", "## 3. External calls (I3 / I8)", ""]
    for f in rep["files"]:
        for e in f.get("external_calls", []):
            o.append("- `%s:%d` %s%s — `%s`" % (
                f["file"], e["line"], e["kind"], " **UNCHECKED?**" if e.get("unchecked") else "", e["text"],
            ))
    o += [
        "",
        "## 4. Next steps",
        "1. Inventory movers (from → to, auth).",
        "2. Write I1–I8 hypotheses; score (funds, reachability, auth, novelty).",
        "3. Deep-read ≥8 to HOLDS / BROKEN / OPEN — BROKEN is a human stamp only.",
        "",
        "_No PoCs, forks, simulations, or transactions. Static + read-only only._",
    ]
    return "\n".join(o) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Read-only invariant surface report. Heuristic leads — not findings. "
                    "No network, no transactions, no PoCs.",
    )
    ap.add_argument("paths", nargs="*", help="source tree(s) or single .sol/.vy file(s)")
    ap.add_argument("-o", "--output", help="write Markdown report here")
    ap.add_argument("--json", dest="json_out", help="write JSON report ('-' = stdout)")
    ap.add_argument("--include-tests", action="store_true")
    ap.add_argument("--address", help="annotation only, no network")
    ap.add_argument("--chain", default="ethereum", help="annotation only, no network")
    a = ap.parse_args(argv)
    if not a.paths:
        ap.print_help()
        return 2
    rep = run_scan(a.paths, include_tests=a.include_tests, address=a.address, chain=a.chain)
    if a.json_out == "-":
        print(json.dumps(rep, indent=2))
    else:
        md = render_md(rep)
        if a.output:
            parent = os.path.dirname(os.path.abspath(a.output))
            if parent:
                os.makedirs(parent, exist_ok=True)
            open(a.output, "w", encoding="utf-8").write(md)
            print("wrote", a.output, file=sys.stderr)
        else:
            sys.stdout.write(md)
        if a.json_out:
            open(a.json_out, "w", encoding="utf-8").write(json.dumps(rep, indent=2))
            print("wrote", a.json_out, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
