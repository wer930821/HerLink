import assert from "node:assert/strict";
import fs from "node:fs";

const collection=fs.readFileSync(new URL("../app/collection/page.tsx",import.meta.url),"utf8");
const chat=fs.readFileSync(new URL("../app/session/[id]/RandomSessionClient.tsx",import.meta.url),"utf8");

assert.match(collection,/sessionStorage\.setItem\("herlink:replay-egg",kind\)/);
assert.match(collection,/herlink:collection-return/);
assert.match(collection,/router\.push\(back\)/);
assert.doesNotMatch(collection,/onClick=\{\(\)=>\{setPreview\(kind\)\}\}/);

// The chat page must consume the replay request and route it through the same
// native trigger used by live easter eggs, without recording a new unlock.
assert.match(chat,/sessionStorage\.getItem\("herlink:replay-egg"\)/);
assert.match(chat,/sessionStorage\.removeItem\("herlink:replay-egg"\)/);
assert.match(chat,/triggerEasterEgg\(replay, false, true\)/);
assert.match(chat,/COLLECTION_EGG_META\[kind\]\?\.duration/);

console.log("collection replay contract ok");
