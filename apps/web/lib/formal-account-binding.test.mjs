import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/formal-account-binding.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

assert.ok(source.includes('e2817803-1304-4ef0-b0b8-66f473b12886'), "只能讓正式孤星企鵝 UUID 綁定");
assert.ok(source.includes('supabase.auth.updateUser({'), "必須原地更新既有 auth user");
assert.ok(source.includes('email:'), "必須綁定 Email");
assert.ok(source.includes('password:'), "必須由本人設定密碼");
assert.ok(source.includes('supabase.auth.signInWithPassword'), "必須提供既有帳號登入");
assert.ok(source.includes('.select("id, anonymous_display_name")'), "登入與綁定後必須核對匿名 profile");
assert.ok(source.includes('孤星企鵝'), "必須核對正式匿名名稱");
assert.ok(source.includes('pathname !== "/"'), "正式帳號入口只能顯示在首頁");
assert.ok(layout.includes('<FormalAccountBinding />'), "正式站必須掛載帳號入口");

console.log("formal account binding contract: OK");
