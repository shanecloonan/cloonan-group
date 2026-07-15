"use client";

import type {
  ChainParams,
  FraudContestSnapshot,
  LightCheckpointSummary,
  MempoolPulse,
  StoragePulse,
} from "@/lib/testnet/types";
import { truncateId } from "./ui";

type Props = {
  chainParams: ChainParams | null;
  checkpoint: LightCheckpointSummary | null;
  fraudContests: FraudContestSnapshot | null;
  storagePulse: StoragePulse | null;
  mempoolPulse: MempoolPulse | null;
  p2pDiversity?: number | null;
  loading?: boolean;
};

export default function ChainVerifiability({
  chainParams,
  checkpoint,
  fraudContests,
  storagePulse,
  mempoolPulse,
  p2pDiversity,
  loading,
}: Props) {
  const treasury = formatMfn(chainParams?.treasury_base_units, chainParams?.mfn_decimals);
  const feeBps = chainParams?.emission?.fee_to_treasury_bps;
  const subsidyBps = chainParams?.emission?.subsidy_to_treasury_bps;

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="font-[family-name:var(--font-pw-display)] text-2xl tracking-tight text-[var(--pw-ink)] sm:text-3xl">
          Verifiability & permanence
        </h2>
        <p className="max-w-2xl text-sm text-[var(--pw-muted)]">
          Public economics and integrity signals — treasury totals, checkpoint
          digests, and storage anchors. Nothing here deanonymizes wallet users.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-3">
        <Tile
          label="Treasury"
          value={loading && !chainParams ? "…" : treasury ?? "—"}
          hint="Protocol-owned pool (fees + subsidies)"
        />
        <Tile
          label="Fee → treasury"
          value={feeBps != null ? `${feeBps / 100}%` : loading ? "…" : "—"}
          hint="User fee share credited on-chain"
        />
        <Tile
          label="Subsidy → treasury"
          value={subsidyBps != null ? `${subsidyBps / 100}%` : loading ? "…" : "—"}
          hint="Block subsidy tail split"
        />
        <Tile
          label="Storage anchors"
          value={
            storagePulse?.totalAnchors != null
              ? storagePulse.totalAnchors.toLocaleString()
              : loading
                ? "…"
                : "—"
          }
          hint={
            storagePulse?.avgReplication != null
              ? `avg replication ×${storagePulse.avgReplication}`
              : "Permanence commitments on-chain"
          }
        />
        <Tile
          label="Mempool pending"
          value={
            mempoolPulse != null
              ? String(mempoolPulse.poolLen)
              : loading
                ? "…"
                : "—"
          }
          hint="Awaiting inclusion — ids only, no graph"
        />
        <Tile
          label="Fraud contests"
          value={
            fraudContests?.configured === false
              ? "off"
              : fraudContests?.contest_count != null
                ? String(fraudContests.contest_count)
                : loading
                  ? "…"
                  : "0"
          }
          hint="P2P-verified invalid-block challenges"
        />
        <Tile
          label="P2P diversity"
          value={
            p2pDiversity != null
              ? `${p2pDiversity} /16 buckets`
              : loading
                ? "…"
                : "—"
          }
          hint="Distinct IPv4 /16 prefixes (observer mesh health)"
        />
        <Tile
          label="Quorum stake"
          value={
            chainParams?.consensus?.quorum_stake_bps != null
              ? `${chainParams.consensus.quorum_stake_bps / 100}%`
              : loading
                ? "…"
                : "—"
          }
          hint="BFT finality threshold"
        />
        <Tile
          label="Min replication"
          value={
            chainParams?.endowment?.min_replication != null
              ? `×${chainParams.endowment.min_replication}`
              : loading
                ? "…"
                : "—"
          }
          hint="SPoRA permanence floor"
        />
      </div>

      {checkpoint && (
        <div className="rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/50 px-4 py-4 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
            Light-client checkpoint (tip)
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
            <CheckpointRow
              label="Checkpoint digest"
              value={truncateId(checkpoint.checkpoint_digest, 8, 8)}
              full={checkpoint.checkpoint_digest}
            />
            <CheckpointRow
              label="Validator set root"
              value={truncateId(checkpoint.validator_set_root, 8, 8)}
              full={checkpoint.validator_set_root}
            />
            <CheckpointRow
              label="Tip block id"
              value={truncateId(checkpoint.tip_block_id, 8, 8)}
              full={checkpoint.tip_block_id}
            />
            <CheckpointRow
              label="Validators in summary"
              value={
                checkpoint.validator_count != null
                  ? String(checkpoint.validator_count)
                  : "—"
              }
            />
          </dl>
          {checkpoint.anchor_peers && checkpoint.anchor_peers.length > 0 && (
            <p className="mt-3 text-[11px] text-[var(--pw-muted)]">
              {checkpoint.anchor_peers.length} anchor peer
              {checkpoint.anchor_peers.length === 1 ? "" : "s"} attested in
              snapshot — boot diversity for light follow.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/60 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
        {label}
      </p>
      <p
        className="mt-1.5 min-w-0 break-words font-mono text-base leading-snug text-[var(--pw-ink)] sm:text-lg xl:text-xl"
        title={value}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--pw-faint)]">
          {hint}
        </p>
      )}
    </div>
  );
}

function CheckpointRow({
  label,
  value,
  full,
}: {
  label: string;
  value: string;
  full?: string;
}) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--pw-faint)]">
        {label}
      </dt>
      <dd
        className="mt-0.5 break-all font-mono text-[11px] text-[var(--pw-ink)] sm:text-[12px]"
        title={full}
      >
        {value}
      </dd>
    </div>
  );
}

function formatMfn(baseUnits?: string, decimals?: number): string | null {
  if (!baseUnits || decimals == null) return null;
  try {
    const raw = BigInt(baseUnits);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const frac = raw % base;
    if (frac === 0n) return `${whole} MFN`;
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${fracStr} MFN`;
  } catch {
    return null;
  }
}
