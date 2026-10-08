import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_HANDOFF_TIMEOUT_MS,
  AI_HELPER_TRIGGER_MS,
  AI_MAX_HANDOFF_REJECTIONS,
  isAiHelperTester,
  nextHandoffState,
  shouldOfferAiHelper,
} from "./ai-helper.ts";

test("AI helper constants match the approved product rules", () => {
  assert.equal(AI_HELPER_TRIGGER_MS, 20_000);
  assert.equal(AI_HANDOFF_TIMEOUT_MS, 10_000);
  assert.equal(AI_MAX_HANDOFF_REJECTIONS, 3);
});

test("only 孤星企鵝 is enabled during the first-stage test", () => {
  assert.equal(isAiHelperTester("孤星企鵝"), true);
  assert.equal(isAiHelperTester(" 孤星企鵝 "), false);
  assert.equal(isAiHelperTester("撿光星塵"), false);
  assert.equal(isAiHelperTester(null), false);
});

test("offer appears at 20 seconds only while still unmatched", () => {
  const base = { displayName: "孤星企鵝", hasHumanSession: false, aiAlreadyOffered: false };

  assert.equal(shouldOfferAiHelper({ ...base, elapsedMs: 19_999 }), false);
  assert.equal(shouldOfferAiHelper({ ...base, elapsedMs: 20_000 }), true);
  assert.equal(shouldOfferAiHelper({ ...base, elapsedMs: 20_001, hasHumanSession: true }), false);
  assert.equal(shouldOfferAiHelper({ ...base, elapsedMs: 20_001, aiAlreadyOffered: true }), false);
  assert.equal(shouldOfferAiHelper({ ...base, elapsedMs: 20_001, displayName: "其他人" }), false);
});

test("third rejected human handoff pauses matching", () => {
  assert.deepEqual(nextHandoffState({ rejectionCount: 0, action: "reject" }), {
    rejectionCount: 1,
    pauseMatching: false,
  });
  assert.deepEqual(nextHandoffState({ rejectionCount: 1, action: "timeout" }), {
    rejectionCount: 2,
    pauseMatching: false,
  });
  assert.deepEqual(nextHandoffState({ rejectionCount: 2, action: "reject" }), {
    rejectionCount: 3,
    pauseMatching: true,
  });
});

test("restart clears rejection protection", () => {
  assert.deepEqual(nextHandoffState({ rejectionCount: 3, action: "restart" }), {
    rejectionCount: 0,
    pauseMatching: false,
  });
});
