/**
 * Inside-bet options for a pocket (mobile picker + helpers).
 */

import {
  columnNumbers,
  cornerKey,
  sixLineKey,
  splitKey,
  streetKey,
  type PlacementKey,
} from "./roulette-keys";
import { PAYOUT_TO_ONE } from "./roulette";

export type InsideBetOption = {
  key: PlacementKey;
  label: string;
  payoutToOne: number;
};

function addOption(map: Map<PlacementKey, InsideBetOption>, key: PlacementKey, label: string) {
  if (map.has(key)) return;
  const payoutToOne =
    key.startsWith("straight:")
      ? PAYOUT_TO_ONE.straight
      : key.startsWith("split:")
        ? PAYOUT_TO_ONE.split
        : key.startsWith("street:")
          ? PAYOUT_TO_ONE.street
          : key.startsWith("corner:")
            ? PAYOUT_TO_ONE.corner
            : key.startsWith("six_line:")
              ? PAYOUT_TO_ONE.six_line
              : 0;
  map.set(key, { key, label, payoutToOne });
}

/** All valid inside bets touching pocket `n` (European layout). */
export function insideBetsForPocket(n: number): InsideBetOption[] {
  const map = new Map<PlacementKey, InsideBetOption>();

  addOption(map, `straight:${n}`, `Straight ${n}`);

  if (n === 0) {
    addOption(map, splitKey(0, 1), "0/1");
    addOption(map, splitKey(0, 2), "0/2");
    addOption(map, splitKey(0, 3), "0/3");
    return [...map.values()];
  }

  const col = Math.floor((n - 1) / 3);
  const { top, mid, bot } = columnNumbers(col);
  addOption(map, streetKey(bot, mid, top), `Street ${bot}–${top}`);

  if (n === top) addOption(map, splitKey(top, mid), `${top}/${mid}`);
  if (n === mid) {
    addOption(map, splitKey(mid, top), `${top}/${mid}`);
    addOption(map, splitKey(mid, bot), `${mid}/${bot}`);
  }
  if (n === bot) addOption(map, splitKey(bot, mid), `${mid}/${bot}`);

  const prev = col > 0 ? columnNumbers(col - 1) : null;
  const next = col < 11 ? columnNumbers(col + 1) : null;

  if (next) {
    addOption(map, sixLineKey(bot, mid, top, next.bot, next.mid, next.top), `Line ${bot}–${next.top}`);
    if (n === top) addOption(map, splitKey(top, next.top), `${top}/${next.top}`);
    if (n === mid) addOption(map, splitKey(mid, next.mid), `${mid}/${next.mid}`);
    if (n === bot) addOption(map, splitKey(bot, next.bot), `${bot}/${next.bot}`);
    if (n === bot) addOption(map, cornerKey(bot, mid, next.bot, next.mid), `Corner ${bot}-${next.mid}`);
    if (n === mid) addOption(map, cornerKey(mid, top, next.mid, next.top), `Corner ${top}-${next.top}`);
  }

  if (prev) {
    const p = prev;
    addOption(map, sixLineKey(p.bot, p.mid, p.top, bot, mid, top), `Line ${p.bot}–${top}`);
    if (n === top) addOption(map, splitKey(top, prev.top), `${top}/${prev.top}`);
    if (n === mid) addOption(map, splitKey(mid, prev.mid), `${mid}/${prev.mid}`);
    if (n === bot) addOption(map, splitKey(bot, prev.bot), `${bot}/${prev.bot}`);
    if (n === bot) addOption(map, cornerKey(prev.bot, prev.mid, bot, mid), `Corner ${prev.bot}-${mid}`);
    if (n === mid) addOption(map, cornerKey(prev.mid, prev.top, mid, top), `Corner ${prev.top}-${top}`);
  }

  return [...map.values()];
}
