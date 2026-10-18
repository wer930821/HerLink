import { NextResponse, type NextRequest } from "next/server";
import {
  MAINTENANCE_MESSAGE,
  MAINTENANCE_TITLE,
} from "./lib/site-config";

// Reopen switch. Defaults to ON (paused) so merging this change is safe:
// production stays paused until the env var is deliberately flipped.
// - Preview testing: set NEXT_PUBLIC_MAINTENANCE_MODE=false on the Preview environment.
// - Production reopen: set NEXT_PUBLIC_MAINTENANCE_MODE=false on Production and redeploy.
const MAINTENANCE_MODE = process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "false";

export function proxy(request: NextRequest) {
  if (!MAINTENANCE_MODE) {
    return NextResponse.next();
  }
  // Admin backend stays reachable during maintenance so the site can be
  // managed (via the HerLink 後台 app) while the public site is paused.
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/")
  ) {
    return NextResponse.next();
  }
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${MAINTENANCE_TITLE}</title></head><body style="margin:0;background:#0d0b18;color:#f6f2ff;font-family:system-ui;min-height:100vh"><main style="max-width:680px;margin:auto;padding:64px 28px"><p>暫停服務</p><h1 style="font-size:48px">${MAINTENANCE_TITLE}</h1><p style="font-size:22px;line-height:1.7;color:#c9c2d8">${MAINTENANCE_MESSAGE}</p><p style="font-size:18px;color:#9e96af">暫停期間無法進入既有聊天室或開始新的配對。</p></main></body></html>`;
  return new NextResponse(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
