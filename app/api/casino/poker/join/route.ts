import { NextResponse } from "next/server";
import { serverJoinPokerRoom } from "@/lib/casino/poker-room-server";
import { requireUser, supabaseFromRequest } from "@/lib/casino/supabase-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  roomId?: string;
  preferredSeat?: number;
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

  if (!body.roomId) {
    return NextResponse.json({ error: "roomId required" }, { status: 400 });
  }

  const { room, error, status } = await serverJoinPokerRoom(
    supabase,
    auth.userId,
    body.roomId,
    body.preferredSeat,
  );

  if (error) {
    return NextResponse.json({ error }, { status: status ?? 400 });
  }
  return NextResponse.json({ room });
}
