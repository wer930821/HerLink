export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ waiting: 0 }, { status: 503 });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { count, error } = await client
    .from("random_match_queue")
    .select("user_id", { count: "exact", head: true })
    .eq("status", "waiting");
  if (error) return Response.json({ waiting: 0 }, { status: 500 });
  return Response.json({ waiting: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
