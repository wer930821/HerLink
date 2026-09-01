export const dynamic = "force-dynamic";

import { adminJson, getAdminContext } from "../_shared";

export async function GET(request: Request) {
  const admin = await getAdminContext(request);
  if ("error" in admin) {
    return admin.error;
  }

  return adminJson({ role: admin.context.role });
}
