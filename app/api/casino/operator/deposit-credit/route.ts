/**
 * Operator / indexer webhook — credit a user's ledger after on-chain deposit.
 * Auth: Authorization: Bearer <CASINO_OPERATOR_SECRET>
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serverCreditDeposit } from "@/lib/casino/deposit-credit";
import type { ChainId, TokenSpec } from "@/lib/casino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xvjqxjakckkbfsdrntwk.supabase.co";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

interface Body {
  userId?: string;
  chainId?: ChainId;
  token?: TokenSpec;
  txHash?: string;
  walletAddress?: string;
  amountUnits?: string;
}

function checkOperatorAuth(req: Request): boolean {
  const secret = process.env.CASINO_OPERATOR_SECRET ?? "";
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === secret;
}

export async function POST(req: Request) {
  if (!checkOperatorAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.userId || !body.chainId || !body.token || !body.txHash || !body.walletAddress) {
    return NextResponse.json(
      { error: "userId, chainId, token, txHash, walletAddress required" },
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let amountUnits: bigint | undefined;
  if (body.amountUnits) {
    try {
      amountUnits = BigInt(body.amountUnits);
    } catch {
      return NextResponse.json({ error: "invalid amountUnits" }, { status: 400 });
    }
  }

  const result = await serverCreditDeposit(supabase, body.userId, {
    chainId: body.chainId,
    token: body.token,
    txHash: body.txHash,
    walletAddress: body.walletAddress,
    amountUnits,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    amount: result.amount.toString(),
    alreadyCredited: result.alreadyCredited,
  });
}
