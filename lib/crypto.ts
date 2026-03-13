const PBKDF2_ITERATIONS = 600_000;

function b64Encode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64Decode(s: string): ArrayBuffer {
  const bin = atob(s);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

async function saltFromUserId(userId: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  return crypto.subtle.digest("SHA-256", enc.encode(userId));
}

export async function deriveVaultKey(password: string, userId: string): Promise<CryptoKey> {
  const salt = await saltFromUserId(userId);
  return deriveKey(password, salt);
}

export async function exportVaultKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return b64Encode(raw);
}

export async function importVaultKey(b64: string): Promise<CryptoKey> {
  const raw = b64Decode(b64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { ciphertext: b64Encode(ct), iv: b64Encode(iv.buffer) };
}

export async function decrypt(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
  const ct = b64Decode(ciphertext);
  const ivBuf = b64Decode(iv);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, ct);
  return new TextDecoder().decode(plain);
}

const KEY_CHECK_PLAINTEXT = "moneyfund_vault_ok";

export async function createKeyCheck(key: CryptoKey): Promise<string> {
  const { ciphertext, iv } = await encrypt(KEY_CHECK_PLAINTEXT, key);
  return `${iv}:${ciphertext}`;
}

export async function verifyKeyCheck(keyCheck: string, key: CryptoKey): Promise<boolean> {
  try {
    const [iv, ciphertext] = keyCheck.split(":");
    const result = await decrypt(ciphertext, iv, key);
    return result === KEY_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}
