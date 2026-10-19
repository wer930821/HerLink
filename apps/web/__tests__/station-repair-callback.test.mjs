import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRepairCallback } from '../lib/station-operator/repair-callback.mjs';

const secret='callback-secret';

test('unauthorized callback returns 401 without db mutation', async () => {
  let calls=0;
  const result=await handleRepairCallback({authorization:'Bearer wrong',secret,payload:{repairId:'r1',event:'ci_success'},db:{applyRepairEvent:async()=>{calls++;}}});
  assert.equal(result.status,401);
  assert.equal(calls,0);
});

test('authorized callback applies only repair id event and safe metadata', async () => {
  let received;
  const result=await handleRepairCallback({authorization:`Bearer ${secret}`,secret,payload:{repairId:'r1',event:'ci_success',runId:123,commitSha:'abc',secret:'must-not-forward'},db:{applyRepairEvent:async input=>{received=input; return {status:'waiting_deploy',changed:true};}}});
  assert.equal(result.status,200);
  assert.deepEqual(received,{repairId:'r1',event:'ci_success',metadata:{runId:123,commitSha:'abc'}});
});

test('malformed callback returns 400', async () => {
  const result=await handleRepairCallback({authorization:`Bearer ${secret}`,secret,payload:{repairId:'r1',event:'unknown'},db:{applyRepairEvent:async()=>{throw new Error('should not run');}}});
  assert.equal(result.status,400);
});
