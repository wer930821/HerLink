import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProductionHealth, decideProductionRepair } from '../lib/station-operator/production-health.mjs';

test('deployment failure never finalizes repair', async () => {
  const result = await decideProductionRepair({ deploymentStatus: 'ERROR', healthCheck: async () => true });
  assert.deepEqual(result, { action: 'human_review', reason: 'deployment_failed' });
});

test('deployment timeout never finalizes repair', async () => {
  const result = await decideProductionRepair({ deploymentStatus: 'TIMEOUT', healthCheck: async () => true });
  assert.deepEqual(result, { action: 'human_review', reason: 'deployment_timeout' });
});

test('health failure never finalizes repair', async () => {
  const result = await decideProductionRepair({ deploymentStatus: 'READY', healthCheck: async () => false });
  assert.deepEqual(result, { action: 'human_review', reason: 'health_failed' });
});

test('only READY deployment plus passing health may finalize', async () => {
  const result = await decideProductionRepair({ deploymentStatus: 'READY', healthCheck: async () => true });
  assert.deepEqual(result, { action: 'complete' });
});

test('production health accepts a successful response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200 });
  assert.equal(await verifyProductionHealth({ url: 'https://example.test', fetchImpl }), true);
});

test('production health rejects non-success response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  assert.equal(await verifyProductionHealth({ url: 'https://example.test', fetchImpl }), false);
});