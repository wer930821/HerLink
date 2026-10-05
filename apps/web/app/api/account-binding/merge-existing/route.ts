import { NextRequest, NextResponse } from "next/server";

const TEST_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const TEST_NAME = "孤星企鵝";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { targetUserId?: string; dryRun?: boolean } | null;
  if (!body?.targetUserId || typeof body.dryRun !== "boolean") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json({ error: "backend_merge_not_enabled", testUserId: TEST_USER_ID, testName: TEST_NAME }, { status: 503 });
}
