import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRepairCallback } from '../lib/station-operator/repair-callback.mjs';

const secret='callback-secret';
const repairId='123e4567-e89b-42d3-a456-426614174000';

test('unauthorized callback returns 401 without db mutation', async () => {
  let calls=0;
  const result=await handleRepairCallback({authorization:'Bearer wrong',secret,payload:{repairId,event:'ci_success'},db:{applyRepairEvent:async()=>{calls++;}}});
  assert.equal(result.status,401);
  assert.equal(calls,0);
});

test('authorized callback applies only repair id event and safe metadata', async () => {
  let received;
  const result=await handleRepairCallback({authorization:`Bearer ${secret}`,secret,payload:{repairId,event:'ci_success',runId:123,commitSha:'abc',secret:'must-not-forward'},db:{applyRepairEvent:async input=>{received=input; return {status:'waiting_deploy',changed:true};}}});
  assert.equal(result.status,200);
  assert.deepEqual(received,{repairId,event:'ci_success',metadata:{runId:123,commitSha:'abc'}});
});

test('malformed callback returns 400', async () => {
  const result=await handleRepairCallback({authorization:`Bearer ${secret}`,secret,payload:{repairId,event:'unknown'},db:{applyRepairEvent:async()=>{throw new Error('should not run');}}});
  assert.equal(result.status,400);
});

test('non UUID repair id returns 400 without db mutation', async () => {
  let calls=0;
  const result=await handleRepairCallback({authorization:`Bearer ${secret}`,secret,payload:{repairId:'r1',event:'ci_success'},db:{applyRepairEvent:async()=>{calls++;}}});
  assert.equal(result.status,400);
  assert.equal(calls,0);
});

test('illegal repair transition returns 409 without leaking database error', async () => {
  const result=await handleRepairCallback({authorization:`Bearer ${secret}`,secret,payload:{repairId,event:'ci_success'},db:{applyRepairEvent:async()=>{throw new Error('invalid repair transition: verifying -> ci_success internal-row-data');}}});
  assert.equal(result.status,409);
  assert.deepEqual(result.body,{ok:false,error:'invalid_transition'});
  assert.doesNotMatch(JSON.stringify(result), /internal-row-data/);
});
