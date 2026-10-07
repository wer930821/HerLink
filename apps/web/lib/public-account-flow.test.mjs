import assert from "node:assert/strict";
import fs from "node:fs";

const login = fs.readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const signup = fs.readFileSync(new URL("../app/signup/page.tsx", import.meta.url), "utf8");

assert.doesNotMatch(login, /GUXING_USER_ID|僅供孤星企鵝使用|登入後會回到孤星企鵝/);
assert.doesNotMatch(signup, /TEST_NAME|孤星企鵝專用測試頁面|正在確認測試身分/);
assert.match(signup, /type SignupMode = "new" \| "bind"/);
assert.match(signup, /updateUser\(\{\s*email:/);
assert.match(signup, /signUp\(email\.trim\(\), password\)/);
assert.match(signup, /setMode\("new"\)/);
assert.match(signup, /setMode\([^\n]*\? "bind" : "new"\)/);
assert.doesNotMatch(signup, /目前沒有可綁定的匿名身分。/);
assert.doesNotMatch(signup, /signInAnonymously/);
assert.match(signup, /建立 HerLink 帳號後即可登入使用/);
assert.match(signup, /為目前的匿名身分建立登入方式/);
assert.match(login, /登入後會接回這個帳號原本的匿名身分/);
console.log("public account flow contract OK");
