import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xvjqxjakckkbfsdrntwk.supabase.co";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Supabase client scoped to the caller's JWT (API routes). */
export function supabaseFromRequest(req: Request): SupabaseClient {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {},
  });
}

export async function requireUser(
  supabase: SupabaseClient,
): Promise<{ userId: string } | { error: string; status: number }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { error: "Sign in required", status: 401 };
  return { userId: user.id };
}
