import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeOperatorRequest } from '../lib/station-operator/auth.mjs';

test('rejects missing bearer secret', () => {
  assert.equal(authorizeOperatorRequest(null, 'secret'), false);
});

test('rejects wrong bearer secret', () => {
  assert.equal(authorizeOperatorRequest('Bearer wrong', 'secret'), false);
});

test('accepts exact bearer secret', () => {
  assert.equal(authorizeOperatorRequest('Bearer secret', 'secret'), true);
});
