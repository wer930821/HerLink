import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./account-binding.ts", import.meta.url), "utf8");

assert.ok(source.includes('ACCOUNT_BINDING_TEST_DISPLAY_NAME = "孤星企鵝"'), "只允許孤星企鵝測試");
assert.ok(source.includes("session?.user?.is_anonymous === true"), "必須先確認目前仍是匿名 Supabase 使用者");
assert.ok(source.includes("updateUser({ email: email.trim(), password })"), "Email 與密碼必須同一次原地升級");
assert.ok(source.includes("update.data.user.id !== userId"), "升級後必須核對 UUID");
assert.ok(source.includes("after.data?.anonymous_display_name !== before.data?.anonymous_display_name"), "升級後必須核對匿名名稱");

console.log("account-binding helper contract: OK");
