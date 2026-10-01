export const dynamic = "force-dynamic";

import { adminJson, getAdminContext } from "../_shared";

export async function POST(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) return admin.error;

  try {
    const body = await request.json().catch(() => null) as {
      expiresMinutes?: number;
      maxAttempts?: number;
    } | null;

    const expiresMinutes = body?.expiresMinutes ?? 30;
    const maxAttempts = body?.maxAttempts ?? 5;

    const result = await admin.context.client.rpc("create_admin_invite_code", {
      p_expires_minutes: expiresMinutes,
      p_max_attempts: maxAttempts,
    });

    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row?.invite_code) throw new Error("INVITE_NOT_CREATED");

    return adminJson({
      inviteCode: row.invite_code,
      expiresAt: row.expires_at,
    });
  } catch {
    return adminJson({ error: "目前無法建立管理員建立碼。" }, 500);
  }
}
