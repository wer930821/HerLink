import assert from "node:assert/strict";
import test from "node:test";

import { getAiHelperOfferState } from "./ai-helper-waiting.ts";

test("does not offer before 20 seconds", () => {
  assert.equal(getAiHelperOfferState({ displayName: "孤星企鵝", elapsedMs: 19_999, matched: false, dismissed: false }), "hidden");
});

test("offers at 20 seconds only to 孤星企鵝", () => {
  assert.equal(getAiHelperOfferState({ displayName: "孤星企鵝", elapsedMs: 20_000, matched: false, dismissed: false }), "offer");
  assert.equal(getAiHelperOfferState({ displayName: "其他人", elapsedMs: 60_000, matched: false, dismissed: false }), "hidden");
});

test("never offers after a human match or after dismissal", () => {
  assert.equal(getAiHelperOfferState({ displayName: "孤星企鵝", elapsedMs: 30_000, matched: true, dismissed: false }), "hidden");
  assert.equal(getAiHelperOfferState({ displayName: "孤星企鵝", elapsedMs: 30_000, matched: false, dismissed: true }), "hidden");
});
