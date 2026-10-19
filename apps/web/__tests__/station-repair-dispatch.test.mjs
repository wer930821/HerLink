import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairDispatch, buildRepairEngineRequest } from '../lib/station-operator/repair-dispatch.mjs';

test('builds an isolated ai-repair branch request from a low-risk queued repair', () => {
  const result=buildRepairDispatch({
    repair:{id:'r1',job_id:'j1',status:'queued',risk:'low',summary:'回覆訊息按鈕沒有反應'},
    attemptCount:1
  });
  assert.deepEqual(result,{
    ok:true,
    repairId:'r1',
    jobId:'j1',
    branch:'ai-repair/j1',
    summary:'回覆訊息按鈕沒有反應',
    attempt:1
  });
});

test('fails closed for high-risk, non-queued, or over-limit repairs', () => {
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'queued',risk:'high',summary:'x'},attemptCount:1}).ok,false);
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'ci_running',risk:'low',summary:'x'},attemptCount:1}).ok,false);
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'queued',risk:'low',summary:'x'},attemptCount:3}).ok,false);
});

test('never places mailbox identifiers or unsafe branch text into branch name', () => {
  const result=buildRepairDispatch({repair:{id:'r1',job_id:'../../main',thread_id:'secret-thread',status:'queued',risk:'low',summary:'x'},attemptCount:1});
  assert.equal(result.ok,false);
});

test('builds a repair engine request without mailbox thread or raw messages', () => {
  const request=buildRepairEngineRequest({
    dispatch:{ok:true,repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆訊息按鈕沒有反應',attempt:1},
    repair:{thread_id:'private-thread',trigger_message_id:'private-message'},
    messages:[{body:'raw mailbox content'}]
  });
  assert.deepEqual(request,{
    repairId:'r1',
    jobId:'j1',
    branch:'ai-repair/j1',
    summary:'回覆訊息按鈕沒有反應',
    attempt:1,
    allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/']
  });
  assert.doesNotMatch(JSON.stringify(request), /private-thread|private-message|raw mailbox content/);
});

test('repair engine request rejects invalid dispatch objects', () => {
  assert.throws(()=>buildRepairEngineRequest({dispatch:{ok:false}}), /invalid repair dispatch/i);
});
