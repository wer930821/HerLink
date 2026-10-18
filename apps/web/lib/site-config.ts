// Maintenance switch shared by the edge gate (proxy.ts) and client pages.
// NEXT_PUBLIC_ prefix: inlined at build time for client components, also readable at runtime in middleware.
// Defaults to ON (paused). Reopen = set NEXT_PUBLIC_MAINTENANCE_MODE=false and redeploy.
export const MAINTENANCE_MODE = process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "false";

export const MAINTENANCE_TITLE = "HerLink 暫停服務中";

export const MAINTENANCE_MESSAGE = "網站目前進行系統與營運調整，暫時停止配對及聊天服務。已有的聊天資料不會因本次暫停而主動刪除。恢復時間將另行公告。";
