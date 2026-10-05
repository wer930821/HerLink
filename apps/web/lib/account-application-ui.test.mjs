import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.ok(source.includes('canTestAccountBinding(state.profile, state.session)'), "申請帳號入口必須沿用 UUID + 匿名名稱測試 gate");
assert.ok(source.includes('申請帳號'), "孤星企鵝測試介面必須提供申請帳號入口");
assert.ok(source.includes('type="email"'), "申請表單必須包含 Email 欄位");
assert.ok(source.includes('type="password"'), "申請表單必須包含密碼欄位");
assert.ok(source.includes('saveAnonymousAccount(accountEmail, accountPassword)'), "提交必須呼叫原地 updateUser helper");
assert.ok(source.includes('帳號申請完成'), "成功後必須有明確完成提示");

console.log("account application UI contract: OK");
