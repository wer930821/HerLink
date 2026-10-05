import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../apps/web/app/page.tsx", import.meta.url), "utf8");

assert.match(source, /HAPPY HALLOWEEN/, "首頁應有萬聖節主視覺");
assert.match(source, /aria-label="彩蛋圖鑑與任務"/, "信箱旁應有小王冠彩蛋入口");
assert.match(source, /const isGuxingPenguin = anonymousSummary\?\.name === "孤星企鵝"/, "帳號按鈕必須只由孤星企鵝條件控制");
assert.match(source, /isGuxingPenguin[\s\S]*申請帳號[\s\S]*登入既有帳號/, "孤星企鵝區塊應包含申請與登入按鈕");
assert.match(source, /匿名聯絡人[\s\S]*isGuxingPenguin/, "申請與登入區塊應位於匿名聯絡人之後");
assert.doesNotMatch(source, /position:\s*["']fixed["']/, "帳號按鈕不可使用 fixed 疊在頁尾");

console.log("web-home-ui-guxing contract: ok");
