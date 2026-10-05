import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./auth-ui.ts", import.meta.url), "utf8");
assert.ok(source.includes('profiles_anonymous_display_name_normalized_unique'), "必須辨識匿名名稱唯一限制錯誤");
assert.ok(source.includes('這個匿名名稱已被使用，請換一個'), "名稱重複時必須顯示明確中文提示");
console.log("auth-ui duplicate-name contract: OK");
