import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRepairEvent } from '../lib/station-operator/repair-state.mjs';

test('CI success advances waiting_ci to waiting_deploy', () => {
  assert.deepEqual(applyRepairEvent({ status: 'waiting_ci', event: 'ci_success' }), { status: 'waiting_deploy', changed: true });
});

test('duplicate callback is idempotent', () => {
  assert.deepEqual(applyRepairEvent({ status: 'waiting_deploy', event: 'ci_success' }), { status: 'waiting_deploy', changed: false });
});

test('illegal backward transition is rejected', () => {
  assert.throws(() => applyRepairEvent({ status: 'verifying', event: 'ci_success' }), /invalid repair transition/);
});

test('CI failure requires human review', () => {
  assert.deepEqual(applyRepairEvent({ status: 'waiting_ci', event: 'ci_failure' }), { status: 'human_review', changed: true });
});

test('deploy success advances to verifying', () => {
  assert.deepEqual(applyRepairEvent({ status: 'waiting_deploy', event: 'deploy_success' }), { status: 'verifying', changed: true });
});

test('deploy failure requires human review', () => {
  assert.deepEqual(applyRepairEvent({ status: 'waiting_deploy', event: 'deploy_failure' }), { status: 'human_review', changed: true });
});
