import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const supabaseSource = fs.readFileSync(new URL("../apps/web/lib/supabase.ts", import.meta.url), "utf8");
const signupSource = fs.readFileSync(new URL("../apps/web/app/signup/page.tsx", import.meta.url), "utf8");

test("anonymous account binding preserves the current auth UUID", () => {
  assert.match(supabaseSource, /beginAnonymousAccountBinding/);
  assert.match(supabaseSource, /auth\.updateUser\(\{\s*email:/s);
  assert.match(supabaseSource, /finishAnonymousAccountBinding/);
  assert.match(supabaseSource, /auth\.updateUser\(\{\s*password/s);
});

test("signup binding flow does not create a second auth user", () => {
  assert.match(signupSource, /beginAnonymousAccountBinding/);
  assert.doesNotMatch(signupSource, /\bsignUp\(/);
});

test("signup page keeps an anonymous session instead of redirecting it away", () => {
  assert.match(signupSource, /is_anonymous/);
  assert.match(signupSource, /驗證信/);
});
