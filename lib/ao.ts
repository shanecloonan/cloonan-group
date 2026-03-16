/**
 * AO (Arweave Operating System) compute layer integration.
 *
 * AO is a hyper-parallel compute environment on Arweave. This module provides:
 * - Reading process state via dryrun (CU)
 * - Sending messages to processes (MU)
 * - Token balance queries (ao tokens)
 * - Process info and result reading
 *
 * Uses direct REST API + ANS-104 data items — no aoconnect SDK dependency.
 */

import { createSignedDataItem } from "./turbo";
import { b64urlEncode } from "./arweave";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const AO_MU_URL = "https://mu.ao-testnet.xyz";
const AO_CU_URL = "https://cu.ao-testnet.xyz";
const AO_GATEWAY = "https://arweave.net";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AoTag {
  name: string;
  value: string;
}

export interface AoMessage {
  process: string;
  tags: AoTag[];
  data?: string;
  anchor?: string;
}

export interface AoResult {
  Messages: AoResultMessage[];
  Spawns: unknown[];
  Output: AoResultOutput;
  GasUsed?: number;
}

export interface AoResultMessage {
  Target: string;
  Tags: AoTag[];
  Data?: string;
  Anchor?: string;
}

export interface AoResultOutput {
  data?: string;
  prompt?: string;
  print?: boolean;
}

export interface AoTokenInfo {
  name: string;
  ticker: string;
  denomination: number;
  logo?: string;
  processId: string;
}

export interface AoProcessInfo {
  processId: string;
  owner: string;
  module: string;
  scheduler: string;
  tags: AoTag[];
}

/* ------------------------------------------------------------------ */
/*  Dryrun — read-only evaluation on the CU                           */
/* ------------------------------------------------------------------ */

export async function dryrun(
  processId: string,
  tags: AoTag[],
  data?: string,
  ownerAddress?: string,
): Promise<AoResult> {
  const body = {
    Id: "0000000000000000000000000000000000000000001",
    Target: processId,
    Owner: ownerAddress || "0000000000000000000000000000000000000000000",
    Tags: [
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      ...tags,
    ],
    Data: data || "",
    Anchor: "0",
  };

  const res = await fetch(`${AO_CU_URL}/dry-run?process-id=${processId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AO dryrun failed (${res.status}): ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Read result of a message evaluation                                */
/* ------------------------------------------------------------------ */

export async function readResult(
  messageId: string,
  processId: string,
): Promise<AoResult> {
  const res = await fetch(
    `${AO_CU_URL}/result/${messageId}?process-id=${processId}`,
  );

  if (!res.ok) {
    throw new Error(`AO result read failed (${res.status})`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Send message — signed data item to the MU                         */
/* ------------------------------------------------------------------ */

export async function sendMessage(
  msg: AoMessage,
  jwk: JsonWebKey,
): Promise<string> {
  const allTags: AoTag[] = [
    { name: "Data-Protocol", value: "ao" },
    { name: "Variant", value: "ao.TN.1" },
    { name: "Type", value: "Message" },
    { name: "SDK", value: "MoneyFund" },
    ...msg.tags,
  ];

  const data = new TextEncoder().encode(msg.data || "");

  const { dataItem, id } = await createSignedDataItem(
    data,
    jwk,
    allTags,
    { target: msg.process, anchor: msg.anchor },
  );

  const res = await fetch(AO_MU_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Accept: "application/json",
    },
    body: dataItem as unknown as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AO message send failed (${res.status}): ${text}`);
  }

  return id;
}

/* ------------------------------------------------------------------ */
/*  Token operations (ao Standard Token)                               */
/* ------------------------------------------------------------------ */

export async function getTokenInfo(processId: string): Promise<AoTokenInfo> {
  const result = await dryrun(processId, [
    { name: "Action", value: "Info" },
  ]);

  const tags = result.Messages?.[0]?.Tags || [];
  const tagMap: Record<string, string> = {};
  for (const t of tags) tagMap[t.name] = t.value;

  return {
    name: tagMap.Name || "Unknown",
    ticker: tagMap.Ticker || "???",
    denomination: parseInt(tagMap.Denomination || "0"),
    logo: tagMap.Logo,
    processId,
  };
}

export async function getTokenBalance(
  processId: string,
  walletAddress: string,
): Promise<string> {
  const result = await dryrun(
    processId,
    [
      { name: "Action", value: "Balance" },
      { name: "Recipient", value: walletAddress },
    ],
    undefined,
    walletAddress,
  );

  const tags = result.Messages?.[0]?.Tags || [];
  const balTag = tags.find((t) => t.name === "Balance");
  if (balTag) return balTag.value;

  // Fallback: some tokens return balance in Data
  const data = result.Messages?.[0]?.Data;
  if (data && /^\d+$/.test(data.trim())) return data.trim();

  return "0";
}

export async function getTokenBalances(
  processId: string,
): Promise<Record<string, string>> {
  const result = await dryrun(processId, [
    { name: "Action", value: "Balances" },
  ]);

  const data = result.Messages?.[0]?.Data;
  if (!data) return {};

  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function transferToken(
  processId: string,
  recipient: string,
  quantity: string,
  jwk: JsonWebKey,
): Promise<string> {
  return sendMessage(
    {
      process: processId,
      tags: [
        { name: "Action", value: "Transfer" },
        { name: "Recipient", value: recipient },
        { name: "Quantity", value: quantity },
      ],
    },
    jwk,
  );
}

/* ------------------------------------------------------------------ */
/*  Well-known AO process IDs                                          */
/* ------------------------------------------------------------------ */

export const AO_TOKENS = {
  ARIO: "agYcCFJtrMG6cqMuZfskIkFTGvUPddICmtQSBIoPdiA",
  TRUNK: "OT9qTE2467gcozb2g8R6D6N3nQS94ENcaAIJfUzHCww",
  LLAMA: "pazXumQI-HPH7iFGfTC-4_7biSnqz_U67oFAGICrusU",
  BARK: "BUhZLMwQ6yZHguLtJYA5lLUa9LQzLXMXRfaq9FVcPJc",
} as const;

/* ------------------------------------------------------------------ */
/*  Process info                                                       */
/* ------------------------------------------------------------------ */

export async function getProcessInfo(
  processId: string,
): Promise<AoProcessInfo | null> {
  try {
    const res = await fetch(
      `${AO_GATEWAY}/graphql`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query { transaction(id: "${processId}") { owner { address } tags { name value } } }`,
        }),
      },
    );

    if (!res.ok) return null;
    const { data } = await res.json();
    const tx = data?.transaction;
    if (!tx) return null;

    const tags = (tx.tags || []) as AoTag[];
    const tagMap: Record<string, string> = {};
    for (const t of tags) tagMap[t.name] = t.value;

    return {
      processId,
      owner: tx.owner?.address || "",
      module: tagMap.Module || "",
      scheduler: tagMap.Scheduler || "",
      tags,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

export function formatTokenAmount(
  raw: string,
  denomination: number,
): string {
  const num = Number(raw);
  if (isNaN(num)) return "0";
  if (denomination === 0) return num.toString();
  return (num / Math.pow(10, denomination)).toFixed(
    Math.min(denomination, 8),
  );
}
