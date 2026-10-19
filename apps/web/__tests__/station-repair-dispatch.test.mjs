import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairDispatch, buildRepairEngineRequest, validateRepairPlan } from '../lib/station-operator/repair-dispatch.mjs';

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

test('accepts a small constrained repair plan containing only allowed app files', () => {
  const result=validateRepairPlan({files:[
    {path:'apps/web/components/ReplyButton.tsx',content:'export function ReplyButton(){ return null; }'},
    {path:'apps/web/__tests__/reply-button.test.mjs',content:'// regression test'}
  ]});
  assert.deepEqual(result,{ok:true,files:[
    {path:'apps/web/components/ReplyButton.tsx',content:'export function ReplyButton(){ return null; }'},
    {path:'apps/web/__tests__/reply-button.test.mjs',content:'// regression test'}
  ]});
});

test('rejects repair plans that touch workflow, migration, secrets, operator safety code, or too many files', () => {
  for (const path of [
    '.github/workflows/pwn.yml',
    'supabase/migrations/evil.sql',
    'apps/web/.env.local',
    'apps/web/lib/station-operator/worker.mjs',
    'apps/web/app/api/internal/station-repair/callback/route.ts'
  ]) {
    assert.equal(validateRepairPlan({files:[{path,content:'x'}]}).ok,false,path);
  }
  assert.equal(validateRepairPlan({files:Array.from({length:6},(_,i)=>({path:`apps/web/components/F${i}.tsx`,content:'x'}))}).ok,false);
});

test('rejects empty, duplicate, oversized, or command-bearing repair plans', () => {
  assert.equal(validateRepairPlan({files:[]}).ok,false);
  assert.equal(validateRepairPlan({files:[{path:'apps/web/components/A.tsx',content:'x'},{path:'apps/web/components/A.tsx',content:'y'}]}).ok,false);
  assert.equal(validateRepairPlan({files:[{path:'apps/web/components/A.tsx',content:'x'.repeat(50001)}]}).ok,false);
  assert.equal(validateRepairPlan({files:[{path:'apps/web/components/A.tsx',content:'```sh\nrm -rf /\n```'}]}).ok,false);
});
