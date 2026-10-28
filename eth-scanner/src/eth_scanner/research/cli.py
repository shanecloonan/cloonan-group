"""CLI: python -m eth_scanner.research run --address 0x…

Defensive analysis only. No exploit / PoC / live fund-moving commands.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from eth_scanner.config import load_settings
from eth_scanner.receipt import default_receipt_dir
from eth_scanner.research import RESEARCH_STACK_VERSION
from eth_scanner.research.invariants import generate_invariant_stubs
from eth_scanner.research.pipeline import run_research
from eth_scanner.store.supabase import open_store


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    p = argparse.ArgumentParser(
        prog="eth-scanner-research",
        description=(
            "Research-grade defensive audit stack (Phase 1). "
            "Lane A picker is the gate. Findings are invariant / property reports. No PoCs."
        ),
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    run_p = sub.add_parser("run", help="Lane A classify → IR → Slither → funds-flow → receipt")
    run_p.add_argument("--address", required=True, help="0x…")
    run_p.add_argument("--source", help="local .sol/.vy file or directory (dry-run / no Etherscan)")
    run_p.add_argument("--tvl", type=float, default=None)
    run_p.add_argument("--dry-run", action="store_true", help="force local work/ store")
    run_p.add_argument("--receipt-dir", help="directory for research .md + .json receipts")
    run_p.add_argument("--no-receipt", action="store_true")
    run_p.add_argument("--no-slither", action="store_true")
    run_p.add_argument("--no-forge", action="store_true")
    run_p.add_argument("--foundry-project", help="optional Foundry project root for L4 runner")

    gen = sub.add_parser("generate-invariants", help="write Foundry invariant stubs for a role")
    gen.add_argument("--role", required=True, choices=("vault", "staking", "lending"))
    gen.add_argument("--out", required=True, help="destination directory")
    gen.add_argument("--address", default="")

    ver = sub.add_parser("version", help="print research stack version")

    args = p.parse_args(argv)
    if args.cmd == "version":
        print(RESEARCH_STACK_VERSION)
        return 0

    if args.cmd == "generate-invariants":
        paths = generate_invariant_stubs(args.role, Path(args.out), address=args.address)
        for path in paths:
            print(path)
        return 0 if paths else 2

    settings = load_settings()
    if args.dry_run:
        settings.dry_run = True
    store = open_store(settings)
    dest = Path(args.receipt_dir) if args.receipt_dir else default_receipt_dir(settings.work_dir)
    run = run_research(
        args.address,
        settings=settings,
        store=store,
        source_path=Path(args.source) if args.source else None,
        tvl_usd=args.tvl,
        receipt_dir=dest,
        write_receipts=not args.no_receipt,
        try_slither=not args.no_slither,
        try_forge=not args.no_forge,
        foundry_project=Path(args.foundry_project) if args.foundry_project else None,
    )
    print(json.dumps(run.to_dict(), indent=2))
    print(
        "research v%s gated=%s layers=%s"
        % (RESEARCH_STACK_VERSION, run.gated, ",".join(run.layers_run)),
        file=sys.stderr,
    )
    if run.receipt_md_path:
        print("research-receipt %s" % run.receipt_md_path, file=sys.stderr)
    if run.receipt_json_path:
        print("research-json %s" % run.receipt_json_path, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
