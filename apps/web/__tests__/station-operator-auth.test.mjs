import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedOperatorRequest } from '../lib/station-operator/auth.mjs';

test('rejects missing or wrong bearer secret',()=>{
  assert.equal(isAuthorizedOperatorRequest(null,'abc'),false);
  assert.equal(isAuthorizedOperatorRequest('Bearer nope','abc'),false);
});
test('accepts exact bearer secret',()=>assert.equal(isAuthorizedOperatorRequest('Bearer abc','abc'),true));
