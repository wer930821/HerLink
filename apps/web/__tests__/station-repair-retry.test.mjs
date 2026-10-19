import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRepairState } from '../lib/station-operator/repair-retry.mjs';

test('green CI moves a repair to waiting_merge',()=>{
  assert.deepEqual(nextRepairState({status:'waiting_ci',attempt:1,event:'ci_success'}),{ok:true,status:'waiting_merge',attempt:1});
});

test('first CI failure allows exactly one sanitized retry on the same branch',()=>{
  const result=nextRepairState({status:'waiting_ci',attempt:1,event:'ci_failure',ciSummary:'Typecheck failed\nTOKEN=secret-value'});
  assert.equal(result.ok,true);
  assert.equal(result.status,'queued');
  assert.equal(result.attempt,2);
  assert.match(result.ciSummary,/Typecheck failed/);
  assert.doesNotMatch(result.ciSummary,/secret-value/);
});

test('second CI failure stops at human_review',()=>{
  assert.deepEqual(nextRepairState({status:'waiting_ci',attempt:2,event:'ci_failure',ciSummary:'tests failed'}),{ok:true,status:'human_review',attempt:2,reason:'max_attempts'});
});

test('rejects third attempt and invalid transitions',()=>{
  assert.equal(nextRepairState({status:'waiting_ci',attempt:3,event:'ci_failure'}).ok,false);
  assert.equal(nextRepairState({status:'queued',attempt:1,event:'ci_success'}).ok,false);
  assert.equal(nextRepairState({status:'waiting_ci',attempt:1,event:'unknown'}).ok,false);
});
