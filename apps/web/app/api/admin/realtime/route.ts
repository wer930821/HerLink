export const dynamic = "force-dynamic";

import { loadAdminRealtimeDiagnostics } from "../../../../lib/admin-data";
import { adminJson, getAdminContext, parsePageParam } from "../_shared";

export async function GET(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) {
    return admin.error;
  }

  const { searchParams } = new URL(request.url);
  const page = parsePageParam(searchParams, "page", 1, 200);
  const pageSize = parsePageParam(searchParams, "pageSize", 50, 100);
  const sessionId = searchParams.get("sessionId");
  const eventType = searchParams.get("eventType");

  try {
    const result = await loadAdminRealtimeDiagnostics(admin.context.client, {
      sessionId,
      eventType,
      page,
      pageSize,
    });
    return adminJson(result);
  } catch (error) {
    return adminJson(
      {
        error: error instanceof Error ? error.message : "無法載入即時診斷資料。",
      },
      500
    );
  }
}
