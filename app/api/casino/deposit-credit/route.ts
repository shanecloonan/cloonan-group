import { NextResponse } from "next/server";
import { serverCreditDeposit } from "@/lib/casino/deposit-credit";
import { requireUser, supabaseFromRequest } from "@/lib/casino/supabase-request";
import type { ChainId, TokenSpec } from "@/lib/casino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  chainId?: ChainId;
  token?: TokenSpec;
  txHash?: string;
  walletAddress?: string;
  amountUnits?: string;
}

export async function POST(req: Request) {
  const supabase = supabaseFromRequest(req);
  const auth = await requireUser(supabase);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.chainId || !body.token || !body.txHash || !body.walletAddress) {
    return NextResponse.json(
      { error: "chainId, token, txHash, walletAddress required" },
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

  const result = await serverCreditDeposit(supabase, auth.userId, {
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
