import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync(new URL("./account-binding.ts", import.meta.url), "utf8");
const onboarding = fs.readFileSync(new URL("../app/onboarding/page.tsx", import.meta.url), "utf8");

assert.ok(helper.includes('ACCOUNT_BINDING_TEST_DISPLAY_NAME = "孤星測"'), "Preview 測試名稱必須使用短前綴");
assert.ok(helper.includes('startsWith(`${ACCOUNT_BINDING_TEST_DISPLAY_NAME}_`)'), "帳號申請必須接受短前綴加唯一碼");
assert.ok(onboarding.includes('`${ACCOUNT_BINDING_TEST_DISPLAY_NAME}_${userId.slice(0, 6)}`'), "Preview 匿名名稱必須使用短前綴加 UUID 唯一碼");
assert.ok(helper.includes('session?.user?.id !== ACCOUNT_BINDING_PRODUCTION_USER_ID'), "正式孤星企鵝 UUID 必須持續排除");

console.log("account-binding short preview prefix: OK");
