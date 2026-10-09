import { NextResponse, type NextRequest } from "next/server";

export function proxy(_request: NextRequest) {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HerLink 暫停服務中</title></head><body style="margin:0;background:#0d0b18;color:#f6f2ff;font-family:system-ui;min-height:100vh"><main style="max-width:680px;margin:auto;padding:64px 28px"><p>暫停服務</p><h1 style="font-size:48px">HerLink 暫停服務中</h1><p style="font-size:22px;line-height:1.7;color:#c9c2d8">網站目前進行系統與營運調整，暫時停止配對及聊天服務。已有的聊天資料不會因本次暫停而主動刪除。恢復時間將另行公告。</p><p style="font-size:18px;color:#9e96af">暫停期間無法進入既有聊天室或開始新的配對。</p></main></body></html>`;
  return new NextResponse(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
