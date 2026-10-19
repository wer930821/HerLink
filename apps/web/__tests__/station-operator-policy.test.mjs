import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision, requiresHumanReview } from '../lib/station-operator/policy.mjs';

test('accepts a safe direct reply decision', () => {
  const value = validateDecision({ kind:'reply', reply:'收到，我會協助確認。', actions:[], confidence:0.91, needsHuman:false });
  assert.equal(value.kind, 'reply');
  assert.equal(value.needsHuman, false);
});

test('forces dangerous actions to human review', () => {
  for (const action of ['delete_data','billing_change','secret_change','permission_escalation','production_migration']) {
    assert.equal(requiresHumanReview([action]), true);
  }
});

test('rejects model invented actions', () => {
  assert.throws(() => validateDecision({ kind:'reply', reply:'x', actions:['run_arbitrary_sql'], confidence:1, needsHuman:false }));
});

test('bug reports may only request an isolated repair handoff', () => {
  const value = validateDecision({ kind:'bug_repair', reply:'已收到問題，我會先檢查。', actions:['create_bug_repair'], confidence:0.8, needsHuman:false });
  assert.deepEqual(value.actions, ['create_bug_repair']);
});
