import assert from "node:assert/strict";
import fs from "node:fs";

const proxyPath = new URL("../proxy.ts", import.meta.url);
assert.equal(fs.existsSync(proxyPath), true, "full maintenance mode must be enforced before app code loads");

const source = fs.readFileSync(proxyPath, "utf8");
assert.match(source, /HerLink 暫停服務中/);
assert.match(source, /NextResponse/);
assert.match(source, /_next\/static/);
assert.doesNotMatch(source, /supabase/i, "maintenance gate must not initialize Supabase");

console.log("full maintenance gate contract passed");
