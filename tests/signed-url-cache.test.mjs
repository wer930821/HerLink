import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(repoRoot, "work", "test-build");
rmSync(buildDir, { recursive: true, force: true });
execFileSync(process.execPath, [
  join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  "--ignoreConfig",
  join(repoRoot, "lib", "signed-url-cache.ts"),
  "--target",
  "ES2022",
  "--module",
  "nodenext",
  "--moduleResolution",
  "nodenext",
  "--skipLibCheck",
  "--outDir",
  buildDir,
], { stdio: "inherit" });

const {
  clearSignedUrlCache,
  getCachedSignedUrl,
  invalidateCachedSignedUrl,
} = await import(pathToFileURL(join(buildDir, "signed-url-cache.js")).href);

const TTL_MS = 300_000;
const REFRESH_THRESHOLD_MS = 60_000;

test.beforeEach(() => {
  clearSignedUrlCache();
});

test.after(() => {
  rmSync(buildDir, { recursive: true, force: true });
});

test("gets a signed URL the first time a path is displayed", async () => {
  let calls = 0;

  const url = await getCachedSignedUrl("session/a.jpg", async () => {
    calls += 1;
    return "https://example.test/a-v1";
  }, { now: 1_000, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });

  assert.equal(url, "https://example.test/a-v1");
  assert.equal(calls, 1);
});

test("reuses a valid URL for a second display of the same path", async () => {
  let calls = 0;
  const signer = async () => `https://example.test/a-v${++calls}`;

  await getCachedSignedUrl("session/a.jpg", signer, { now: 1_000, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });
  const second = await getCachedSignedUrl("session/a.jpg", signer, { now: 2_000, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });

  assert.equal(second, "https://example.test/a-v1");
  assert.equal(calls, 1);
});

test("does not re-sign a valid URL after four minutes without a new display request", async () => {
  let calls = 0;
  const signer = async () => `https://example.test/a-v${++calls}`;

  await getCachedSignedUrl("session/a.jpg", signer, { now: 0, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });

  assert.equal(calls, 1);
});

test("keeps using a URL while it remains outside the refresh threshold", async () => {
  let calls = 0;
  const signer = async () => `https://example.test/a-v${++calls}`;

  await getCachedSignedUrl("session/a.jpg", signer, { now: 0, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });
  const url = await getCachedSignedUrl("session/a.jpg", signer, { now: 239_999, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });

  assert.equal(url, "https://example.test/a-v1");
  assert.equal(calls, 1);
});

test("refreshes only when a displayed path is within the expiry threshold", async () => {
  let calls = 0;
  const signer = async () => `https://example.test/a-v${++calls}`;

  await getCachedSignedUrl("session/a.jpg", signer, { now: 0, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });
  const refreshed = await getCachedSignedUrl("session/a.jpg", signer, { now: 240_000, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });

  assert.equal(refreshed, "https://example.test/a-v2");
  assert.equal(calls, 2);
});

test("shares one in-flight signing request between concurrent instances", async () => {
  let calls = 0;
  let release;
  const signer = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = () => resolve("https://example.test/a-v1");
    });
  };

  const first = getCachedSignedUrl("session/a.jpg", signer, { now: 0, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });
  const second = getCachedSignedUrl("session/a.jpg", signer, { now: 0, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS });
  release();

  assert.deepEqual(await Promise.all([first, second]), ["https://example.test/a-v1", "https://example.test/a-v1"]);
  assert.equal(calls, 1);
});

test("does not retry a failed signer automatically", async () => {
  let calls = 0;
  const signer = async () => {
    calls += 1;
    throw new Error("signing failed");
  };

  await assert.rejects(() => getCachedSignedUrl("session/a.jpg", signer, { now: 0, ttlMs: TTL_MS, refreshThresholdMs: REFRESH_THRESHOLD_MS }));
  assert.equal(calls, 1);

  invalidateCachedSignedUrl("session/a.jpg");
  assert.equal(calls, 1);
});
