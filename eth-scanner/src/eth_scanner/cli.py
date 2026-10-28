"""CLI: lane-a, lane-b, enqueue, surface, list, receipt.

Defensive analysis only. No exploit / PoC / live fund-moving commands.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

from eth_scanner.config import Settings, load_settings
from eth_scanner.heuristics.invariant_pass import main as surface_main
from eth_scanner.lane_a import worker as lane_a
from eth_scanner.lane_b import worker as lane_b
from eth_scanner.receipt import default_receipt_dir, pick_source_artifact, write_run_receipt
from eth_scanner.store.supabase import normalize_address, open_store
from eth_scanner.types import FunnelResult, to_plain


def _add_receipt_flags(sp: argparse.ArgumentParser) -> None:
    sp.add_argument(
        "--receipt",
        help="write this Markdown receipt file (single address) or a directory of .md files",
    )
    sp.add_argument(
        "--receipt-dir",
        help="directory for Markdown receipts (default: <work>/receipts/)",
    )
    sp.add_argument(
        "--no-receipt",
        action="store_true",
        help="skip writing a Markdown receipt",
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    p = argparse.ArgumentParser(
        prog="eth-scanner",
        description="Ethereum-only defensive invariant scanner (Lane A/B). "
                    "Emits buckets, never a human verdict. No PoCs.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("lane-a", help="S0–S5 cheap skim + S6 gate")
    a.add_argument("--address", action="append", default=[], help="0x… (repeatable)")
    a.add_argument("--file", help="text file of addresses, one per line")
    a.add_argument("--source", help="local .sol/.vy file or directory (dry-run / no Etherscan)")
    a.add_argument("--tvl", type=float, default=None, help="TVL USD override")
    a.add_argument("--claim", type=int, default=0, help="claim N pending rows from the store")
    a.add_argument("--dry-run", action="store_true", help="force local work/ store")
    _add_receipt_flags(a)

    b = sub.add_parser("lane-b", help="S7 on lane-b-queue + manual-review")
    b.add_argument("--address", action="append", default=[], help="0x… (repeatable)")
    b.add_argument("--source", help="optional local source for heuristic re-scan")
    b.add_argument("--tvl", type=float, default=None)
    b.add_argument("--claim", type=int, default=5)
    b.add_argument("--dry-run", action="store_true")
    _add_receipt_flags(b)

    e = sub.add_parser("enqueue", help="upsert addresses as pending targets")
    e.add_argument("addresses", nargs="+")
    e.add_argument("--tvl", type=float, default=None)
    e.add_argument("--dry-run", action="store_true")

    ls = sub.add_parser("list", help="list targets / results")
    ls.add_argument("--bucket", default=None)
    ls.add_argument("--results", action="store_true")
    ls.add_argument("--dry-run", action="store_true")

    rec = sub.add_parser("receipt", help="rebuild a Markdown receipt from the store")
    rec.add_argument("--address", required=True, help="0x…")
    rec.add_argument("--lane", default="A", choices=("A", "B", "a", "b"))
    rec.add_argument("--receipt", help="write this .md file")
    rec.add_argument("--receipt-dir", help="directory for the .md (default: <work>/receipts/)")
    rec.add_argument("--dry-run", action="store_true")

    sub.add_parser("surface", help="run invariant_pass heuristics (passthrough)")

    args, rest = p.parse_known_args(argv)
    if args.cmd == "surface":
        return surface_main(rest)

    settings = load_settings()
    if getattr(args, "dry_run", False):
        settings.dry_run = True
    store = open_store(settings)

    if args.cmd == "enqueue":
        from eth_scanner.types import Target
        for raw in args.addresses:
            t = Target(address=normalize_address(raw), tvl_usd=args.tvl, status="pending")
            store.upsert_target(t)
            print(t.address)
        print("store=%s" % ("remote" if settings.persist_remote else "dry-run %s" % settings.work_dir), file=sys.stderr)
        return 0

    if args.cmd == "list":
        if args.results:
            rows = store.list_results()
        else:
            rows = store.list_targets(bucket=args.bucket)
        print(json.dumps(rows, indent=2))
        return 0

    if args.cmd == "receipt":
        addr = normalize_address(args.address)
        rows = store.list_results(addr, limit=1)
        if not rows:
            print("receipt: no stored result for %s" % addr, file=sys.stderr)
            return 2
        dest_dir, dest_file = _receipt_dest(args, settings, n_results=1)
        path = write_run_receipt(
            address=addr,
            lane=args.lane.upper(),
            result=rows[0],
            artifact=pick_source_artifact(store.list_artifacts(addr)),
            target=store.get_target(addr),
            dest_dir=dest_dir,
            dest_file=dest_file,
            worker_id=settings.worker_id,
        )
        print(path)
        print("receipt %s" % path, file=sys.stderr)
        return 0

    if args.cmd == "lane-a":
        addrs = list(args.address)
        if args.file:
            addrs.extend(_read_addrs(Path(args.file)))
        source = Path(args.source) if args.source else None
        results = []
        if addrs:
            results = lane_a.run_batch(addrs, settings=settings, store=store, source_path=source, tvl_usd=args.tvl)
        elif args.claim:
            results = lane_a.claim_and_run(args.claim, settings=settings)
        else:
            print("lane-a: pass --address, --file, or --claim N", file=sys.stderr)
            return 2
        paths = _emit_receipts(results, settings, store, args, lane="A")
        _print_results(results, settings, paths)
        return 0

    if args.cmd == "lane-b":
        addrs = list(args.address)
        source_text = Path(args.source).read_text(encoding="utf-8") if args.source else None
        results = []
        if addrs:
            for raw in addrs:
                r = lane_b.run_one(raw, settings=settings, store=store, source_text=source_text, tvl_usd=args.tvl)
                results.append((normalize_address(raw), r))
        else:
            results = lane_b.claim_and_run(args.claim, settings=settings)
        paths = _emit_receipts(results, settings, store, args, lane="B")
        _print_results(results, settings, paths)
        return 0

    p.error("unknown command")
    return 2


def _read_addrs(path: Path) -> list[str]:
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def _receipt_dest(args: Any, settings: Settings, n_results: int) -> tuple[Optional[Path], Optional[Path]]:
    raw = getattr(args, "receipt", None)
    dest_dir = getattr(args, "receipt_dir", None)
    dest_file: Optional[Path] = None
    if dest_dir:
        return Path(dest_dir), None
    if raw:
        p = Path(raw)
        if n_results > 1 or p.is_dir() or str(raw).endswith(("/", "\\")):
            return p, None
        if p.suffix.lower() == ".md" or n_results == 1:
            return p.parent if str(p.parent) != "" else default_receipt_dir(settings.work_dir), p
        return p, None
    return default_receipt_dir(settings.work_dir), dest_file


def _emit_receipts(results, settings: Settings, store, args: Any, *, lane: str) -> list[Optional[Path]]:
    if getattr(args, "no_receipt", False):
        return [None] * len(results)
    dest_dir, dest_file = _receipt_dest(args, settings, n_results=len(results))
    paths: list[Optional[Path]] = []
    for addr, res in results:
        this_file = dest_file if dest_file is not None and len(results) == 1 else None
        artifact = pick_source_artifact(store.list_artifacts(addr))
        target = store.get_target(addr)
        path = write_run_receipt(
            address=addr,
            lane=lane,
            result=res if isinstance(res, FunnelResult) else res,
            artifact=artifact,
            target=target,
            dest_dir=None if this_file else dest_dir,
            dest_file=this_file,
            worker_id=settings.worker_id,
        )
        paths.append(path)
    return paths


def _print_results(results, settings, paths: Optional[list[Optional[Path]]] = None) -> None:
    payload = []
    paths = paths or [None] * len(results)
    for (addr, res), path in zip(results, paths):
        payload.append({
            "address": addr,
            "bucket": res.bucket,
            "dropped": res.dropped,
            "drop_reason": res.drop_reason,
            "heat": res.heat,
            "src_confidence": res.src_confidence,
            "ir_confidence": res.ir_confidence,
            "value_movers": res.value_movers,
            "contract_class": res.contract_class,
            "scope": res.scope,
            "stage_trace": to_plain(res.stage_trace),
            "notes": res.notes,
            "receipt_path": str(path) if path else None,
        })
    print(json.dumps(payload, indent=2))
    mode = "supabase" if settings.persist_remote else "dry-run:%s" % settings.work_dir
    print("wrote %d result(s) via %s" % (len(results), mode), file=sys.stderr)
    for path in paths:
        if path:
            print("receipt %s" % path, file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
