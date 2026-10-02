export const dynamic = "force-dynamic";
export const revalidate = 0;

import { createClient } from "@supabase/supabase-js";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return Response.json(
      { waiting: null, available: false },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("get_public_waiting_count");

  if (error) {
    return Response.json(
      { waiting: null, available: false },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  return Response.json(
    { waiting: Number(data ?? 0), available: true },
    { headers: NO_STORE_HEADERS },
  );
}
