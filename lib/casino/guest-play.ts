/**
 * Guest play-money identity — no Supabase account required.
 * Persists a random display name + stable ledger id in localStorage.
 */

import { cryptoRandomId } from "./rng";

const STORAGE_KEY = "mf_casino_guest_v1";

const ADJECTIVES = [
  "Lucky",
  "Golden",
  "Midnight",
  "Royal",
  "Velvet",
  "Cosmic",
  "Diamond",
  "Neon",
  "Silver",
  "Wild",
] as const;

const NOUNS = [
  "Ace",
  "Whale",
  "Shark",
  "Dealer",
  "HighRoller",
  "Phantom",
  "Jackpot",
  "River",
  "Bluff",
  "Chip",
] as const;

export type GuestProfile = {
  guestId: string;
  displayName: string;
  createdAt: string;
  startingBalanceGranted: boolean;
};

function pick<T extends readonly string[]>(arr: T): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomGuestDisplayName(): string {
  const num = 100 + Math.floor(Math.random() * 900);
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${num}`;
}

function readStored(): GuestProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as GuestProfile;
    if (!p.guestId || !p.displayName) return null;
    return {
      ...p,
      startingBalanceGranted: Boolean(p.startingBalanceGranted),
    };
  } catch {
    return null;
  }
}

function writeStored(profile: GuestProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

/** Stable guest id + random username for this browser. */
export function getOrCreateGuestProfile(): GuestProfile & { isNew: boolean } {
  const existing = readStored();
  if (existing) return { ...existing, isNew: false };

  const profile: GuestProfile = {
    guestId: `guest-${cryptoRandomId()}`,
    displayName: randomGuestDisplayName(),
    createdAt: new Date().toISOString(),
    startingBalanceGranted: false,
  };
  writeStored(profile);
  return { ...profile, isNew: true };
}

export function saveGuestProfile(profile: GuestProfile): void {
  writeStored(profile);
}

export function rerollGuestDisplayName(): GuestProfile {
  const base = readStored() ?? getOrCreateGuestProfile();
  const next: GuestProfile = {
    ...base,
    displayName: randomGuestDisplayName(),
  };
  writeStored(next);
  return next;
}

export function markGuestStartingBalanceGranted(): GuestProfile {
  const base = readStored() ?? getOrCreateGuestProfile();
  const next: GuestProfile = { ...base, startingBalanceGranted: true };
  writeStored(next);
  return next;
}

/** Default starting stack on first visit (100k DEV at 6 decimals). */
export const GUEST_STARTING_UNITS = 100_000n * 1_000_000n;

export const PLAY_MONEY_CHIP_PRESETS = [
  { id: "10k", label: "+10K", units: 10_000n * 1_000_000n },
  { id: "100k", label: "+100K", units: 100_000n * 1_000_000n },
  { id: "1m", label: "+1M", units: 1_000_000n * 1_000_000n },
] as const;

export function playMoneyUnits(decimals: number, human: number): bigint {
  return BigInt(human) * 10n ** BigInt(decimals);
}
