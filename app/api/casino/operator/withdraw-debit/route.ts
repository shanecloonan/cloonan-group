/**
 * Operator / indexer webhook — debit locked balance after on-chain withdraw.
 * Auth: Authorization: Bearer <CASINO_OPERATOR_SECRET>
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serverDebitWithdraw } from "@/lib/casino/withdraw-debit";
import {
  casinoOperatorSupabaseUrl,
  checkCasinoOperatorAuth,
} from "@/lib/casino/operator-request";
import type { ChainId, TokenSpec } from "@/lib/casino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

interface Body {
  userId?: string;
  chainId?: ChainId;
  token?: TokenSpec;
  txHash?: string;
  walletAddress?: string;
  amountUnits?: string;
}

export async function POST(req: Request) {
  if (!checkCasinoOperatorAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!serviceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 },
    );
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

  let amountUnits: bigint | undefined;
  if (body.amountUnits) {
    try {
      amountUnits = BigInt(body.amountUnits);
    } catch {
      return NextResponse.json({ error: "invalid amountUnits" }, { status: 400 });
    }
  }

  const supabase = createClient(casinoOperatorSupabaseUrl(), serviceKey);

  const result = await serverDebitWithdraw(supabase, body.userId, {
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
    alreadyDebited: result.alreadyDebited,
  });
}
