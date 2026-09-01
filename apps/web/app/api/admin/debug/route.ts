export const dynamic = "force-dynamic";

import { adminJson } from "../_shared";
import { getAdminRequestDebug } from "../../../../lib/admin-server";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("debug") !== "1") {
    return adminJson({ error: "Not found." }, 404);
  }

  const result = await getAdminRequestDebug(request);
  if (!result.ok) {
    return adminJson({ error: result.message }, result.status);
  }

  return adminJson(result.debug);
}
