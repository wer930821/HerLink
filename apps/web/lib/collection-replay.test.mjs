import assert from "node:assert/strict";
import fs from "node:fs";

const page=fs.readFileSync(new URL("../app/collection/page.tsx",import.meta.url),"utf8");
assert.match(page,/herlink:replay-egg/);
assert.match(page,/herlink:collection-return/);
assert.match(page,/router\.push\(/);
assert.doesNotMatch(page,/onClick=\{\(\)=>\{setPreview\(kind\)\}\}/);
console.log("collection replay contract ok");
