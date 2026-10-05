import assert from "node:assert/strict";
import { normalizeRecoveryResult } from "./recovery-result.mjs";

assert.throws(
  () => normalizeRecoveryResult(null),
  /無法建立恢復申請/,
  "missing recovery row must fail instead of showing a phantom code",
);

assert.throws(
  () => normalizeRecoveryResult({ recovery_code: "ABC12345" }),
  /尚未確認寫入成功/,
  "a code without a persisted request id must not be shown",
);

assert.deepEqual(
  normalizeRecoveryResult({ id: "req-1", recovery_code: "abc12345", expires_at: "2026-10-05T12:00:00Z" }),
  { id: "req-1", recovery_code: "ABC12345", expires_at: "2026-10-05T12:00:00Z" },
);

console.log("recovery result verification: ok");
