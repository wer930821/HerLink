// 網頁版裝置登記（封鎖改進 C）。
//
// App 登入時會登記裝置（lib/device.ts），網頁版以前沒有，
// 所以網頁用戶封鎖不到裝置、換身分就繞過封鎖。
// 這裡沿用網頁本來就有的匿名安裝 ID（localStorage，
// apps/web/lib/anonymous-install.ts），SHA-256 後登記到
// public.devices，之後封鎖對方時一併記進 blocked_devices，
// 配對就會排除同一裝置的新身分。
//
// 限制：清掉瀏覽器資料會產生新的安裝 ID，裝置封鎖也會被繞過；
// 匿名制下沒有 100% 擋得住的方法。登記失敗不擋登入／配對，
// 呼叫端要自己吞掉錯誤。

import { supabase } from "./supabase";
import { getAnonymousInstallationId } from "./anonymous-install";

export async function getDeviceHash(): Promise<string | null> {
  const installationId = getAnonymousInstallationId();
  if (!installationId) {
    return null;
  }
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installationId)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function registerCurrentDevice() {
  const deviceHash = await getDeviceHash();
  if (!deviceHash) {
    return null;
  }
  const { data, error } = await supabase.rpc("register_device", {
    p_device_hash: deviceHash,
  });
  if (error) {
    throw error;
  }
  return (Array.isArray(data) ? data[0] ?? null : data ?? null) as {
    id: string;
    user_id: string;
    device_hash: string;
  } | null;
}
