/**
 * Shared in-process lock so Lane A and research do not clobber work/ together.
 */

let inflight = false;

export function scanInFlight(): boolean {
  return inflight;
}

export function acquireScan(): boolean {
  if (inflight) return false;
  inflight = true;
  return true;
}

export function releaseScan(): void {
  inflight = false;
}
