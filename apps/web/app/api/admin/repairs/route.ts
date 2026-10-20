export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { adminJson, getAdminContext } from "../_shared";

export async function GET(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) return admin.error;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100);
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return adminJson({ error: "AI 維修狀態服務尚未設定。" }, 500);
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await serviceClient
    .from("station_operator_repairs")
    .select("id,job_id,thread_id,status,risk,summary,attempt_count,branch_name,pr_number,commit_sha,ci_run_id,deployment_id,last_error,result,created_at,updated_at,completed_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return adminJson({ error: "無法載入 AI 維修狀態。" }, 500);
  return adminJson({ items: data ?? [], generated_at: new Date().toISOString() });
}
