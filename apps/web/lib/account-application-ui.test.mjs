import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/account-application-test.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

assert.ok(source.includes('canTestAccountBinding(profile, session)'), "申請帳號入口必須沿用 UUID + 匿名名稱測試 gate");
assert.ok(source.includes('申請帳號'), "Preview 測試介面必須提供申請帳號入口");
assert.ok(source.includes('登入原有帳號'), "Preview 測試介面必須提供登入原有帳號入口");
assert.ok(source.includes('type="email"'), "帳號表單必須包含 Email 欄位");
assert.ok(source.includes('type="password"'), "帳號表單必須包含密碼欄位");
assert.ok(source.includes('saveAnonymousAccount(accountEmail, accountPassword)'), "申請提交必須呼叫原地 updateUser helper");
assert.ok(source.includes('signInWithPassword'), "登入必須使用 Supabase Email 密碼登入");
assert.ok(source.includes('loadMyProfile(login.data.user.id)'), "登入後必須載入同一 UUID 的匿名 profile");
assert.ok(source.includes('帳號申請完成'), "申請成功後必須有明確完成提示");
assert.ok(source.includes('登入成功'), "登入成功後必須有明確提示");
assert.ok(layout.includes('<AccountApplicationTest />'), "測試入口必須掛載到 Web 介面");

console.log("account application UI contract: OK");
