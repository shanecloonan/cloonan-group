import { b64urlEncode, b64urlDecode } from "./arweave";
import { TURBO_UPLOAD_URL, TURBO_PAYMENT_URL } from "./config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TurboUploadResult {
  id: string;
  owner: string;
  dataCaches: string[];
  fastFinalityIndexes: string[];
  deadlineHeight: number;
  timestamp: number;
}

export interface TurboBalance {
  winc: string;
}

export interface TurboPriceEstimate {
  winc: string;
  adjustments: { name: string; description: string; operatorMagnitude: number; adjustmentAmount: number }[];
}

/* ------------------------------------------------------------------ */
/*  Primitives                                                         */
/* ------------------------------------------------------------------ */

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...bufs: Uint8Array[]): Uint8Array {
  const total = bufs.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) {
    out.set(b, off);
    off += b.byteLength;
  }
  return out;
}

async function sha384(data: Uint8Array): Promise<Uint8Array> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-384", buf));
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

function longTo8LE(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigInt64(0, BigInt(n), true);
  return buf;
}

function padTo(arr: Uint8Array, len: number): Uint8Array {
  if (arr.byteLength >= len) return arr.slice(0, len);
  const padded = new Uint8Array(len);
  padded.set(arr, len - arr.byteLength);
  return padded;
}

/* ------------------------------------------------------------------ */
/*  Deep Hash — Arweave's recursive SHA-384 hashing for signing        */
/* ------------------------------------------------------------------ */

type DeepHashChunk = Uint8Array | DeepHashChunk[];

async function deepHash(data: DeepHashChunk): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    const tag = concat(
      await sha384(utf8("blob")),
      await sha384(utf8(data.byteLength.toString())),
    );
    return sha384(tag);
  }

  const tag = concat(
    await sha384(utf8("list")),
    await sha384(utf8(data.length.toString())),
  );

  let acc = await sha384(tag);
  for (const chunk of data) {
    acc = await sha384(concat(acc, await deepHash(chunk)));
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/*  Avro tag serialization (ANS-104 spec)                              */
/* ------------------------------------------------------------------ */

function avroVarint(n: number): Uint8Array {
  // zigzag encode, then varint
  let val = (n << 1) ^ (n >> 31);
  const bytes: number[] = [];
  while ((val & ~0x7f) !== 0) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val & 0x7f);
  return new Uint8Array(bytes);
}

function serializeAvroTags(tags: { name: string; value: string }[]): Uint8Array {
  if (tags.length === 0) return new Uint8Array([0]);

  const parts: Uint8Array[] = [];
  parts.push(avroVarint(tags.length));
  for (const t of tags) {
    const nb = utf8(t.name);
    const vb = utf8(t.value);
    parts.push(avroVarint(nb.length), nb, avroVarint(vb.length), vb);
  }
  parts.push(avroVarint(0));
  return concat(...parts);
}

/* ------------------------------------------------------------------ */
/*  ANS-104 Data Item construction + signing                           */
/* ------------------------------------------------------------------ */

const SIG_TYPE_ARWEAVE = 1;
const SIG_LENGTH = 512;
const OWNER_LENGTH = 512;

export async function createSignedDataItem(
  data: Uint8Array,
  jwk: JsonWebKey,
  tags: { name: string; value: string }[],
  opts?: { target?: string; anchor?: string },
): Promise<{ dataItem: Uint8Array; id: string }> {
  const ownerRaw = padTo(new Uint8Array(b64urlDecode(jwk.n!)), OWNER_LENGTH);

  const targetRaw = opts?.target
    ? new Uint8Array(b64urlDecode(opts.target))
    : new Uint8Array(0);

  let anchorRaw = new Uint8Array(0);
  if (opts?.anchor) {
    const raw = utf8(opts.anchor);
    anchorRaw = new Uint8Array(32);
    anchorRaw.set(raw.slice(0, 32));
  }

  const tagsSerialized = serializeAvroTags(tags);

  // Deep hash produces the message to sign
  const message = await deepHash([
    utf8("dataitem"),
    utf8("1"),
    utf8(SIG_TYPE_ARWEAVE.toString()),
    ownerRaw,
    targetRaw,
    anchorRaw,
    tagsSerialized,
    data,
  ]);

  const privKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = padTo(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSA-PSS", saltLength: 0 },
        privKey,
        message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength) as ArrayBuffer,
      ),
    ),
    SIG_LENGTH,
  );

  const id = b64urlEncode(await sha256(sig));

  // Assemble binary
  const parts: Uint8Array[] = [];

  // Signature type (2 bytes LE)
  parts.push(new Uint8Array([SIG_TYPE_ARWEAVE & 0xff, (SIG_TYPE_ARWEAVE >> 8) & 0xff]));
  parts.push(sig);
  parts.push(ownerRaw);

  // Target
  if (targetRaw.length > 0) {
    parts.push(new Uint8Array([1]));
    parts.push(targetRaw);
  } else {
    parts.push(new Uint8Array([0]));
  }

  // Anchor
  if (anchorRaw.length > 0 && opts?.anchor) {
    parts.push(new Uint8Array([1]));
    parts.push(anchorRaw);
  } else {
    parts.push(new Uint8Array([0]));
  }

  // Tags header (8+8 bytes LE) + serialized tags
  parts.push(longTo8LE(tags.length));
  parts.push(longTo8LE(tagsSerialized.length));
  parts.push(tagsSerialized);

  parts.push(data);

  return { dataItem: concat(...parts), id };
}

/* ------------------------------------------------------------------ */
/*  Turbo API — pricing & balance                                      */
/* ------------------------------------------------------------------ */

export async function getTurboPrice(bytes: number): Promise<TurboPriceEstimate> {
  const res = await fetch(`${TURBO_PAYMENT_URL}/v1/price/bytes/${bytes}`);
  if (!res.ok) throw new Error(`Turbo price check failed: ${res.status}`);
  return res.json();
}

export async function getTurboBalance(address: string): Promise<TurboBalance> {
  const res = await fetch(`${TURBO_PAYMENT_URL}/v1/balance/${address}`);
  if (!res.ok) {
    if (res.status === 404) return { winc: "0" };
    throw new Error(`Turbo balance check failed: ${res.status}`);
  }
  return res.json();
}

export function getTurboTopUpUrl(address: string): string {
  return `https://app.ardrive.io/#/sign-in?redirect=fund-wallet`;
}

export function wincToAr(winc: string): string {
  return (Number(winc) / 1e12).toFixed(12);
}

/* ------------------------------------------------------------------ */
/*  Turbo Upload                                                       */
/* ------------------------------------------------------------------ */

export async function uploadToTurbo(
  data: Uint8Array,
  jwk: JsonWebKey,
  tags: { name: string; value: string }[],
  onProgress?: (pct: number) => void,
): Promise<{ id: string; turboResult: TurboUploadResult }> {
  onProgress?.(5);

  const { dataItem, id } = await createSignedDataItem(data, jwk, tags);
  onProgress?.(30);

  const res = await fetch(`${TURBO_UPLOAD_URL}/v1/tx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": dataItem.byteLength.toString(),
    },
    body: dataItem as unknown as BodyInit,
  });

  onProgress?.(90);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 402) {
      throw new Error("Insufficient Turbo credits. Fund your account at app.ardrive.io");
    }
    throw new Error(`Turbo upload failed (${res.status}): ${body}`);
  }

  const turboResult: TurboUploadResult = await res.json();
  onProgress?.(100);

  return { id, turboResult };
}

export async function uploadFileToTurbo(
  file: File,
  jwk: JsonWebKey,
  extraTags: { name: string; value: string }[] = [],
  onProgress?: (pct: number) => void,
): Promise<{ id: string; turboResult: TurboUploadResult }> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const hasCt = extraTags.some((t) => t.name.toLowerCase() === "content-type");
  const tags = hasCt
    ? extraTags
    : [{ name: "Content-Type", value: file.type || "application/octet-stream" }, ...extraTags];
  return uploadToTurbo(buffer, jwk, tags, onProgress);
}
