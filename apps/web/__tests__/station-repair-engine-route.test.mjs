import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepairEngineInvocation } from '../lib/station-operator/repair-engine-route.mjs';

const request={repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆按鈕沒有反應',attempt:1,allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/']};

test('repair engine endpoint accepts only authenticated allowlist low-risk queued repairs',()=>{
  const result=validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1},request});
  assert.deepEqual(result,{ok:true});
});

test('repair engine endpoint fails closed outside allowlist',()=>{
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'dry_run',repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'production',repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1},request}).ok,false);
});

test('repair engine endpoint rejects unauthenticated, high-risk, non-queued, mismatched, and over-limit attempts',()=>{
  assert.equal(validateRepairEngineInvocation({authenticated:false,mode:'allowlist',repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{id:'r1',job_id:'j1',risk:'high',status:'queued',attempt_count:1},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{id:'r1',job_id:'j1',risk:'low',status:'waiting_ci',attempt_count:1},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{id:'other',job_id:'j1',risk:'low',status:'queued',attempt_count:1},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:3},request:{...request,attempt:3}}).ok,false);
});
