import assert from "node:assert/strict";
import fs from "node:fs";

const login = fs.readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const signup = fs.readFileSync(new URL("../app/signup/page.tsx", import.meta.url), "utf8");

assert.doesNotMatch(login, /GUXING_USER_ID|僅供孤星企鵝使用|登入後會回到孤星企鵝/);
assert.doesNotMatch(signup, /TEST_NAME|孤星企鵝專用測試頁面|正在確認測試身分/);
assert.match(signup, /updateUser\(\{\s*email:/);
assert.doesNotMatch(signup, /await signUp\(/);
assert.match(signup, /為目前的匿名身分建立登入方式/);
assert.match(login, /登入後會接回這個帳號原本的匿名身分/);
// A user may open signup after signing out. The signup page must first restore
// the existing anonymous session backup instead of rejecting the page.
assert.match(signup, /signInAnonymously/);
assert.doesNotMatch(signup, /if \(!session\) \{ setAllowed\(false\)/);
console.log("public account flow contract OK");
