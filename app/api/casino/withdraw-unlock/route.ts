import { NextResponse } from "next/server";
import { serverUnlockWithdrawBalance } from "@/lib/casino/withdraw-lock";
import { requireUser, supabaseFromRequest } from "@/lib/casino/supabase-request";
import type { ChainId, TokenSpec } from "@/lib/casino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  chainId?: ChainId;
  token?: TokenSpec;
  amountUnits?: string;
}

export async function POST(req: Request) {
  const supabase = supabaseFromRequest(req);
  const auth = await requireUser(supabase);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.chainId || !body.token || !body.amountUnits) {
    return NextResponse.json(
      { error: "chainId, token, amountUnits required" },
      { status: 400 },
    );
  }

  let amountUnits: bigint;
  try {
    amountUnits = BigInt(body.amountUnits);
  } catch {
    return NextResponse.json({ error: "invalid amountUnits" }, { status: 400 });
  }

  const result = await serverUnlockWithdrawBalance(supabase, auth.userId, {
    chainId: body.chainId,
    token: body.token,
    amountUnits,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ unlocked: result.unlocked });
}
