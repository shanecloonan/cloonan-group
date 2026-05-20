/**
 * Canonical placement keys for inside bets (split / street / corner).
 * Numbers are always sorted ascending in the key payload.
 */

import type { RoulettePlacementKind } from "./roulette";

export type InsidePlacementKey =
  | `split:${string}`
  | `street:${string}`
  | `corner:${string}`
  | `six_line:${string}`;

export type OutsidePlacementKey =
  | `straight:${number}`
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high"
  | "dozen_1"
  | "dozen_2"
  | "dozen_3"
  | "column_1"
  | "column_2"
  | "column_3";

export type PlacementKey = OutsidePlacementKey | InsidePlacementKey;

function numsKey(nums: number[]): string {
  return [...nums].sort((a, b) => a - b).join(",");
}

export function splitKey(a: number, b: number): InsidePlacementKey {
  return `split:${numsKey([a, b])}`;
}

export function streetKey(a: number, b: number, c: number): InsidePlacementKey {
  return `street:${numsKey([a, b, c])}`;
}

export function cornerKey(a: number, b: number, c: number, d: number): InsidePlacementKey {
  return `corner:${numsKey([a, b, c, d])}`;
}

/** Double street — six numbers across two adjacent columns. */
export function sixLineKey(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): InsidePlacementKey {
  return `six_line:${numsKey([a, b, c, d, e, f])}`;
}

export function parseInsideKey(key: InsidePlacementKey): { kind: RoulettePlacementKind; numbers: number[] } {
  const colon = key.indexOf(":");
  const kind = key.slice(0, colon) as RoulettePlacementKind;
  const raw = key.slice(colon + 1);
  const numbers = raw.split(",").map((n) => Number(n));
  return { kind, numbers };
}

/** European column layout: col 0 = 3,2,1 … col 11 = 36,35,34. */
export function columnNumbers(col: number): { top: number; mid: number; bot: number } {
  return { top: 3 + col * 3, mid: 2 + col * 3, bot: 1 + col * 3 };
}
