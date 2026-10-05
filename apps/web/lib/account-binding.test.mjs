import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./account-binding.ts", import.meta.url), "utf8");

assert.ok(source.includes('ACCOUNT_BINDING_PRODUCTION_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886"'), "必須明確封鎖正式孤星企鵝 UUID");
assert.ok(source.includes('process.env.NEXT_PUBLIC_PHASE1_TEST_USER_ID'), "測試 UUID 必須由 Preview branch env 指定");
assert.ok(source.includes('ACCOUNT_BINDING_TEST_DISPLAY_NAME = "孤星企鵝"'), "必須同時核對孤星企鵝匿名名稱");
assert.ok(source.includes("session?.user?.is_anonymous === true"), "必須先確認目前仍是匿名 Supabase 使用者");
assert.ok(source.includes("ACCOUNT_BINDING_TEST_USER_ID !== ACCOUNT_BINDING_PRODUCTION_USER_ID"), "正式孤星企鵝 UUID 永遠不可進入測試流程");
assert.ok(source.includes("session?.user?.id === ACCOUNT_BINDING_TEST_USER_ID"), "session UUID 必須符合 Preview 測試 allowlist");
assert.ok(source.includes("profile?.id === ACCOUNT_BINDING_TEST_USER_ID"), "profile UUID 必須符合 Preview 測試 allowlist");
assert.ok(source.includes("updateUser({ email: email.trim(), password })"), "Email 與密碼必須同一次原地升級");
assert.ok(source.includes("update.data.user.id !== userId"), "升級後必須核對 UUID");
assert.ok(source.includes("after.data?.anonymous_display_name !== before.data?.anonymous_display_name"), "升級後必須核對匿名名稱");

console.log("account-binding helper contract: OK");
