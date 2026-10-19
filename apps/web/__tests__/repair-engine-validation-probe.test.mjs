import test from 'node:test';
import assert from 'node:assert/strict';

test('isolated repair write probe', () => {
  assert.equal('ai-repair/validation-probe'.startsWith('ai-repair/'), true);
});
