import { NextResponse } from "next/server";
import { serverEnforcePokerTurnTimeout } from "@/lib/casino/poker-room-server";
import { requireUser, supabaseFromRequest } from "@/lib/casino/supabase-request";
import type { ChainId, TokenSpec } from "@/lib/casino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  roomId?: string;
  chainId?: ChainId;
  token?: TokenSpec;
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

  if (!body.roomId || !body.chainId || !body.token) {
    return NextResponse.json({ error: "roomId, chainId, token required" }, { status: 400 });
  }

  const { room, error, status } = await serverEnforcePokerTurnTimeout(
    supabase,
    auth.userId,
    body.roomId,
    body.chainId,
    body.token,
  );

  if (error) {
    return NextResponse.json({ error }, { status: status ?? 400 });
  }
  return NextResponse.json({ room });
}
