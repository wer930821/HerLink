export const dynamic = "force-dynamic";

import { loadAdminSummary } from "../../../../lib/admin-data";
import { adminJson, getAdminContext } from "../_shared";

export async function GET(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) {
    return admin.error;
  }

  try {
    const summary = await loadAdminSummary(admin.context.client);
    return adminJson(summary);
  } catch (error) {
    return adminJson(
      {
        error: error instanceof Error ? error.message : "無法載入後台摘要。",
      },
      500
    );
  }
}
