import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepairEngineInvocation, executeRepairEngine } from '../lib/station-operator/repair-engine-route.mjs';

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

test('repair engine execution discovers context, asks model, validates plan, then uses injected writer', async()=>{
  const calls=[];
  const result=await executeRepairEngine({
    authenticated:true,
    mode:'allowlist',
    repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1},
    request,
    discoverContext:async input=>{calls.push(['discover',input.summary]);return{ok:true,context:[{path:'apps/web/app/page.tsx',content:'export default function Page(){}'}]};},
    callModel:async input=>{calls.push(['model',input.input.summary]);return JSON.stringify({cause:'click handler missing',confidence:.9,files:[{path:'apps/web/app/page.tsx',content:'export default function Page(){ return null }'}]});},
    writeRepair:async input=>{calls.push(['write',input.files[0].path]);return{ok:true,branch:'ai-repair/j1',prNumber:99};},
  });
  assert.equal(result.ok,true);
  assert.equal(result.prNumber,99);
  assert.deepEqual(calls.map(x=>x[0]),['discover','model','write']);
});

test('repair engine execution fails closed before writer when model output is unsafe', async()=>{
  let wrote=false;
  const result=await executeRepairEngine({
    authenticated:true,mode:'allowlist',repair:{id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1},request,
    discoverContext:async()=>({ok:true,context:[{path:'apps/web/app/page.tsx',content:'x'}]}),
    callModel:async()=>JSON.stringify({cause:'bad',confidence:.9,command:'rm -rf /',files:[{path:'apps/web/app/page.tsx',content:'x'}]}),
    writeRepair:async()=>{wrote=true;return{ok:true};},
  });
  assert.equal(result.ok,false);
  assert.equal(wrote,false);
});
