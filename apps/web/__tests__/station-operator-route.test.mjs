import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedOperatorRequest } from '../lib/station-operator/auth.mjs';

test('rejects missing bearer secret', () => {
  assert.equal(isAuthorizedOperatorRequest(null, 'secret'), false);
});

test('rejects wrong bearer secret', () => {
  assert.equal(isAuthorizedOperatorRequest('Bearer wrong', 'secret'), false);
});

test('accepts exact bearer secret', () => {
  assert.equal(isAuthorizedOperatorRequest('Bearer secret', 'secret'), true);
});
