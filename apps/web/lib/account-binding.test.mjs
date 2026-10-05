import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./account-binding.ts", import.meta.url), "utf8");

assert.match(source, /ACCOUNT_BINDING_TEST_DISPLAY_NAME\s*=\s*"孤星企鵝"/, "只允許孤星企鵝測試");
assert.match(source, /is_anonymous\s*===\s*true/, "必須先確認目前仍是匿名 Supabase 使用者");
assert.match(source, /updateUser\(\{\s*email:\s*email\.trim\(\),\s*password\s*\}\\?\)/, "Email 與密碼必須同一次原地升級");
assert.match(source, /update\.data\.user\.id\s*!==\s*userId/, "升級後必須核對 UUID");
assert.match(source, /after\.data\?\.anonymous_display_name\s*!==\s*before\.data\?\.anonymous_display_name/, "升級後必須核對匿名名稱");

console.log("account-binding helper contract: OK");
