/**
 * Privacy-safe transaction shape parser.
 * Reads wire counts and flags only — never amounts, keys, or ring indices.
 */

export type TxPrivacyMeta = {
  version: number;
  inputCount: number;
  ringSizes: number[];
  outputCount: number;
  storageOutputs: number;
  hasViewTags: boolean;
  isCoinbase: boolean;
  kind: "coinbase" | "transfer" | "upload" | "mixed";
};

const ENC_AMOUNT_BYTES = 40;
const TX_VERSION_V2 = 2;

class WireReader {
  private off = 0;
  constructor(private readonly buf: Uint8Array) {}

  remaining(): number {
    return this.buf.length - this.off;
  }

  u8(): number {
    if (this.off >= this.buf.length) throw new Error("short");
    return this.buf[this.off++]!;
  }

  u64(): bigint {
    if (this.off + 8 > this.buf.length) throw new Error("short");
    let n = 0n;
    for (let i = 0; i < 8; i++) {
      n = (n << 8n) + BigInt(this.buf[this.off + i]!);
    }
    this.off += 8;
    return n;
  }

  readBytes(n: number): Uint8Array {
    if (this.off + n > this.buf.length) throw new Error("short");
    const slice = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return slice;
  }

  varint(): number {
    let value = 0;
    let shift = 0;
    while (this.off < this.buf.length) {
      const b = this.buf[this.off++]!;
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
      if (shift > 35) throw new Error("varint");
    }
    throw new Error("varint");
  }

  blob(): Uint8Array {
    const n = this.varint();
    return this.readBytes(n);
  }

  point(): void {
    this.readBytes(32);
  }

  points(): number {
    const n = this.varint();
    for (let i = 0; i < n; i++) this.point();
    return n;
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  const raw = hex.replace(/\s+/g, "").toLowerCase();
  if (raw.length < 4 || raw.length % 2 !== 0) return null;
  try {
    const out = new Uint8Array(raw.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  } catch {
    return null;
  }
}

/** Parse structural metadata from canonical tx hex (no secrets). */
export function parseTxPrivacyMeta(hex: string): TxPrivacyMeta | null {
  const bytes = hexToBytes(hex);
  if (!bytes) return null;
  try {
    const r = new WireReader(bytes);
    const version = r.varint();
    r.point(); // r_pub
    r.u64(); // fee
    r.blob(); // extra

    const inputCount = r.varint();
    const ringSizes: number[] = [];
    for (let i = 0; i < inputCount; i++) {
      const pLen = r.points();
      const cLen = r.points();
      ringSizes.push(Math.max(pLen, cLen));
      r.point(); // c_pseudo
      r.blob(); // CLSAG sig
    }

    const outputCount = r.varint();
    let storageOutputs = 0;
    for (let i = 0; i < outputCount; i++) {
      r.point(); // one_time_addr
      r.point(); // amount commitment
      r.blob(); // bulletproof
      r.readBytes(ENC_AMOUNT_BYTES); // enc_amount
      if (version >= TX_VERSION_V2) r.u8(); // view_tag
      const storageFlag = r.u8();
      if (storageFlag === 1) {
        storageOutputs++;
        r.blob(); // storage commitment
      } else if (storageFlag !== 0) {
        throw new Error("storage flag");
      }
    }

    const isCoinbase = inputCount === 0;
    let kind: TxPrivacyMeta["kind"] = "transfer";
    if (isCoinbase) kind = "coinbase";
    else if (storageOutputs > 0 && storageOutputs === outputCount) kind = "upload";
    else if (storageOutputs > 0) kind = "mixed";

    return {
      version,
      inputCount,
      ringSizes,
      outputCount,
      storageOutputs,
      hasViewTags: version >= TX_VERSION_V2,
      isCoinbase,
      kind,
    };
  } catch {
    return null;
  }
}

export type PrivacySampleAggregate = {
  sampled: number;
  totalRings: number;
  ring16Count: number;
  v2Count: number;
  transfers: number;
  uploads: number;
  mixed: number;
  avgRingSize: number | null;
  avgInputs: number | null;
  avgOutputs: number | null;
};

export function aggregatePrivacySamples(
  metas: TxPrivacyMeta[],
): PrivacySampleAggregate {
  const user = metas.filter((m) => !m.isCoinbase);
  if (user.length === 0) {
    return {
      sampled: 0,
      totalRings: 0,
      ring16Count: 0,
      v2Count: 0,
      transfers: 0,
      uploads: 0,
      mixed: 0,
      avgRingSize: null,
      avgInputs: null,
      avgOutputs: null,
    };
  }

  let ring16 = 0;
  let v2 = 0;
  let transfers = 0;
  let uploads = 0;
  let mixed = 0;
  let ringSum = 0;
  let ringN = 0;
  let inSum = 0;
  let outSum = 0;

  for (const m of user) {
    if (m.version >= TX_VERSION_V2) v2++;
    if (m.kind === "transfer") transfers++;
    else if (m.kind === "upload") uploads++;
    else if (m.kind === "mixed") mixed++;
    for (const rs of m.ringSizes) {
      ringSum += rs;
      ringN++;
      if (rs === 16) ring16++;
    }
    inSum += m.inputCount;
    outSum += m.outputCount;
  }

  return {
    sampled: user.length,
    totalRings: ringN,
    ring16Count: ring16,
    v2Count: v2,
    transfers,
    uploads,
    mixed,
    avgRingSize: ringN > 0 ? Math.round((ringSum / ringN) * 10) / 10 : null,
    avgInputs: Math.round((inSum / user.length) * 10) / 10,
    avgOutputs: Math.round((outSum / user.length) * 10) / 10,
  };
}
