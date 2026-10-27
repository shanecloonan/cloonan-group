"""CLI: lane-a, lane-b, enqueue, surface, list.

Defensive analysis only. No exploit / PoC / live fund-moving commands.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from eth_scanner.config import load_settings
from eth_scanner.heuristics.invariant_pass import main as surface_main
from eth_scanner.lane_a import worker as lane_a
from eth_scanner.lane_b import worker as lane_b
from eth_scanner.store.supabase import normalize_address, open_store
from eth_scanner.types import to_plain


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

    b = sub.add_parser("lane-b", help="S7 on lane-b-queue + manual-review")
    b.add_argument("--address", action="append", default=[], help="0x… (repeatable)")
    b.add_argument("--source", help="optional local source for heuristic re-scan")
    b.add_argument("--tvl", type=float, default=None)
    b.add_argument("--claim", type=int, default=5)
    b.add_argument("--dry-run", action="store_true")

    e = sub.add_parser("enqueue", help="upsert addresses as pending targets")
    e.add_argument("addresses", nargs="+")
    e.add_argument("--tvl", type=float, default=None)
    e.add_argument("--dry-run", action="store_true")

    ls = sub.add_parser("list", help="list targets / results")
    ls.add_argument("--bucket", default=None)
    ls.add_argument("--results", action="store_true")
    ls.add_argument("--dry-run", action="store_true")

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
        _print_results(results, settings)
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
        _print_results(results, settings)
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


def _print_results(results, settings) -> None:
    payload = []
    for addr, res in results:
        payload.append({
            "address": addr,
            "bucket": res.bucket,
            "dropped": res.dropped,
            "drop_reason": res.drop_reason,
            "heat": res.heat,
            "src_confidence": res.src_confidence,
            "ir_confidence": res.ir_confidence,
            "value_movers": res.value_movers,
            "stage_trace": to_plain(res.stage_trace),
            "notes": res.notes,
        })
    print(json.dumps(payload, indent=2))
    mode = "supabase" if settings.persist_remote else "dry-run:%s" % settings.work_dir
    print("wrote %d result(s) via %s" % (len(results), mode), file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
