import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorMode, canProcessThread, canMutate } from '../lib/station-operator/mode.mjs';

test('defaults to disabled', () => {
  assert.equal(operatorMode({}), 'disabled');
});

test('legacy enabled flag does not silently enable production', () => {
  assert.equal(operatorMode({STATION_OPERATOR_ENABLED:'true'}), 'disabled');
});

test('dry run can inspect any thread but cannot mutate', () => {
  const env={STATION_OPERATOR_MODE:'dry_run'};
  assert.equal(canProcessThread('t1', env), true);
  assert.equal(canMutate(env), false);
});

test('allowlist processes only explicit test threads and may mutate them', () => {
  const env={STATION_OPERATOR_MODE:'allowlist',STATION_OPERATOR_TEST_THREADS:'t1, t2'};
  assert.equal(canProcessThread('t1', env), true);
  assert.equal(canProcessThread('t3', env), false);
  assert.equal(canMutate(env), true);
});

test('production allows processing and mutation only when explicitly selected', () => {
  const env={STATION_OPERATOR_MODE:'production'};
  assert.equal(canProcessThread('any', env), true);
  assert.equal(canMutate(env), true);
});

test('unknown mode fails closed', () => {
  assert.equal(operatorMode({STATION_OPERATOR_MODE:'oops'}), 'disabled');
  assert.equal(canProcessThread('t1',{STATION_OPERATOR_MODE:'oops'}), false);
});
