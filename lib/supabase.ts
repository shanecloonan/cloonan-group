import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xvjqxjakckkbfsdrntwk.supabase.co";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2anF4amFrY2trYmZzZHJudHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTI0NTQsImV4cCI6MjA4ODg2ODQ1NH0.-yAgsCoJDviO5eS4hym15kI9q6nFDw9HA237_jM7224";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface ShortsHistoryRow {
  id?: number;
  created_at?: string;
  report_date: string;
  filename: string;
  total_shorted: number;
  total_found: number;
  total_lines: number;
  bin2: number;
  bin3: number;
  bin4: number;
  bin5: number;
  bin5plus: number;
  hourly: Record<string, { shorted: number; found: number; lines: number }>;
}
