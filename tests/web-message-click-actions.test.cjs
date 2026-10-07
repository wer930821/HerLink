const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const pagePath = path.join(__dirname, "..", "apps", "web", "app", "session", "[id]", "page.tsx");
const clientPath = path.join(__dirname, "..", "apps", "web", "app", "session", "[id]", "RandomSessionClient.tsx");

test("session action wrapper does not swallow normal message clicks", () => {
  const source = fs.readFileSync(pagePath, "utf8");
  const pointerDown = source.match(/const onPointerDownCapture = [\s\S]*?;\n  const onPointerMoveCapture/);
  assert.ok(pointerDown, "expected pointer down capture handler");
  assert.doesNotMatch(pointerDown[0], /event\.preventDefault\(\)/, "normal pointer down must still allow click handlers");

  const clickCapture = source.match(/const onClickCapture = [\s\S]*?;\n  const reply =/);
  assert.ok(clickCapture, "expected click capture handler");
  assert.doesNotMatch(clickCapture[0], /event\.preventDefault\(\)|event\.stopPropagation\(\)/, "normal clicks must reach bubble and reply quote handlers");
});

test("message bubbles still expose click-to-reply and quote jump handlers", () => {
  const source = fs.readFileSync(clientPath, "utf8");
  assert.match(source, /onClick=\{message\.message_type === "image" \? undefined : \(\) => startReply\(message\)\}/);
  assert.match(source, /onClick=\{\(\) => void handleReplyQuoteClick\(message\)\}/);
});
