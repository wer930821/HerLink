export const dynamic = "force-dynamic";

import { loadAdminSafety } from "../../../../lib/admin-data";
import { adminJson, getAdminContext, parsePageParam } from "../_shared";

export async function GET(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) {
    return admin.error;
  }

  const { searchParams } = new URL(request.url);
  const page = parsePageParam(searchParams, "page", 1, 200);
  const pageSize = parsePageParam(searchParams, "pageSize", 25, 100);

  try {
    const result = await loadAdminSafety(admin.context.client, { page, pageSize });
    return adminJson(result);
  } catch (error) {
    return adminJson(
      {
        error: error instanceof Error ? error.message : "無法載入安全資料。",
      },
      500
    );
  }
}
