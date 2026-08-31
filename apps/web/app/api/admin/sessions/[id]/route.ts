export const dynamic = "force-dynamic";

import { loadAdminSessionDetail } from "../../../../../lib/admin-data";
import { adminJson, getAdminContext } from "../../_shared";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminContext(request);
  if ("error" in admin) {
    return admin.error;
  }

  const resolvedParams = await params;
  const { searchParams } = new URL(request.url);
  const includeMessages = searchParams.get("includeMessages") === "1";

  try {
    const result = await loadAdminSessionDetail(admin.context.client, resolvedParams.id, { includeMessages });
    if (!result) {
      return adminJson({ error: "找不到這段對話。" }, 404);
    }

    return adminJson(result);
  } catch (error) {
    return adminJson(
      {
        error: error instanceof Error ? error.message : "無法載入對話詳情。",
      },
      500
    );
  }
}
