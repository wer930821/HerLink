import { NextResponse } from "next/server";
import { requireAdminRequest } from "../../../lib/admin-server";

export function adminJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function getAdminContext(request: Request) {
  const result = await requireAdminRequest(request);
  if (!result.ok) {
    return { error: adminJson({ error: result.message }, result.status) };
  }

  return { context: result.context };
}

export function parsePageParam(searchParams: URLSearchParams, key: string, fallback: number, max: number) {
  const value = Number.parseInt(searchParams.get(key) ?? "", 10);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, max);
}
