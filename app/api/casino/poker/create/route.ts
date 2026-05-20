import { NextResponse } from "next/server";
import { serverCreatePokerRoom } from "@/lib/casino/poker-room-server";
import { requireUser, supabaseFromRequest } from "@/lib/casino/supabase-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  buyIn?: string;
  bigBlind?: string;
  smallBlind?: string;
  maxSeats?: number;
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

  if (!body.buyIn || !body.bigBlind || !body.smallBlind) {
    return NextResponse.json({ error: "buyIn, bigBlind, smallBlind required" }, { status: 400 });
  }

  let buyIn: bigint;
  let bigBlind: bigint;
  let smallBlind: bigint;
  try {
    buyIn = BigInt(body.buyIn);
    bigBlind = BigInt(body.bigBlind);
    smallBlind = BigInt(body.smallBlind);
  } catch {
    return NextResponse.json({ error: "invalid bigint fields" }, { status: 400 });
  }

  if (buyIn <= 0n || bigBlind <= 0n || smallBlind <= 0n) {
    return NextResponse.json({ error: "amounts must be positive" }, { status: 400 });
  }

  const { room, error, status } = await serverCreatePokerRoom(supabase, auth.userId, {
    buyIn,
    bigBlind,
    smallBlind,
    maxSeats: body.maxSeats,
  });

  if (error) {
    return NextResponse.json({ error }, { status: status ?? 400 });
  }
  return NextResponse.json({ room });
}
