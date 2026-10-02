export const dynamic = "force-dynamic";

import { loadAdminEasterEggAnalytics } from "../../../../lib/admin-data";
import { adminJson, getAdminContext } from "../_shared";

export async function GET(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) return admin.error;
  try {
    return adminJson(await loadAdminEasterEggAnalytics(admin.context.client));
  } catch (error) {
    return adminJson({ error: error instanceof Error ? error.message : "無法載入彩蛋紀錄。" }, 500);
  }
}
