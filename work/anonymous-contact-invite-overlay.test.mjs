import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const clientPath = "apps/web/app/session/[id]/RandomSessionClient.tsx";
const cssPath = "apps/web/app/globals.css";
const client = fs.readFileSync(clientPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

test("incoming anonymous contact invite is rendered in a dedicated overlay above chat messages", () => {
  assert.match(client, /anonymous-contact-invite-overlay/);
  assert.match(client, /contactState\?\.partner_approved\s*&&\s*!contactState\.my_approved/);
  assert.match(css, /\.anonymous-contact-invite-overlay\s*\{[^}]*position:\s*fixed;/s);
  assert.match(css, /\.anonymous-contact-invite-overlay\s*\{[^}]*z-index:\s*(?:[1-9]\d{2,}|\d{4,});/s);
  assert.match(css, /\.anonymous-contact-invite-overlay\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.anonymous-contact-invite-card\s*\{[^}]*pointer-events:\s*auto;/s);
});
