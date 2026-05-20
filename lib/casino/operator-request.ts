/** Shared auth for operator indexer webhooks (`CASINO_OPERATOR_SECRET`). */

export function checkCasinoOperatorAuth(req: Request): boolean {
  const secret = process.env.CASINO_OPERATOR_SECRET ?? "";
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === secret;
}

export function casinoOperatorSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://xvjqxjakckkbfsdrntwk.supabase.co"
  );
}
