import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepairEngineInvocation, executeRepairEngine } from '../lib/station-operator/repair-engine-route.mjs';

const baseSha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const request={repairId:'r1',jobId:'j1',branch:'ai-repair/j1',baseSha,summary:'回覆按鈕沒有反應',attempt:1,allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/']};
const repair={id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1};

test('repair engine endpoint accepts only authenticated allowlist low-risk queued repairs',()=>{
  assert.deepEqual(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair,request}),{ok:true});
});

test('repair engine endpoint requires exact isolated ai-repair branch',()=>{
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair,request:{...request,branch:'main'}}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair,request:{...request,branch:'ai-repair/other'}}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair,request:{...request,branch:undefined}}).ok,false);
});

test('repair engine endpoint requires an immutable 40-char base sha',()=>{
  for (const invalid of [undefined,'main','abc123','g'.repeat(40)]) {
    assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair,request:{...request,baseSha:invalid}}).ok,false);
  }
});

test('repair engine endpoint fails closed outside allowlist',()=>{
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'dry_run',repair,request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'production',repair,request}).ok,false);
});

test('repair engine endpoint rejects unauthenticated, high-risk, non-queued, mismatched, and over-limit attempts',()=>{
  assert.equal(validateRepairEngineInvocation({authenticated:false,mode:'allowlist',repair,request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{...repair,risk:'high'},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{...repair,status:'waiting_ci'},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{...repair,id:'other'},request}).ok,false);
  assert.equal(validateRepairEngineInvocation({authenticated:true,mode:'allowlist',repair:{...repair,attempt_count:3},request:{...request,attempt:3}}).ok,false);
});

test('repair engine execution discovers context, asks model, validates plan, then uses injected writer', async()=>{
  const calls=[];
  let writeInput;
  const result=await executeRepairEngine({authenticated:true,mode:'allowlist',repair,request,
    discoverContext:async input=>{calls.push(['discover',input.summary]);return{ok:true,context:[{path:'apps/web/app/page.tsx',content:'export default function Page(){}'}]};},
    callModel:async input=>{calls.push(['model',input.input.summary]);return JSON.stringify({cause:'click handler missing',confidence:.9,files:[{path:'apps/web/app/page.tsx',content:'export default function Page(){ return null }'}]});},
    writeRepair:async input=>{writeInput=input;calls.push(['write',input.files[0].path]);return{ok:true,branch:'ai-repair/j1',prNumber:99};}});
  assert.equal(result.ok,true); assert.equal(result.prNumber,99); assert.deepEqual(calls.map(x=>x[0]),['discover','model','write']);
  assert.equal(writeInput.baseSha,baseSha);
});

test('repair engine execution fails closed before writer when model output is unsafe', async()=>{
  let wrote=false;
  const result=await executeRepairEngine({authenticated:true,mode:'allowlist',repair,request,
    discoverContext:async()=>({ok:true,context:[{path:'apps/web/app/page.tsx',content:'x'}]}),
    callModel:async()=>JSON.stringify({cause:'bad',confidence:.9,command:'rm -rf /',files:[{path:'apps/web/app/page.tsx',content:'x'}]}),
    writeRepair:async()=>{wrote=true;return{ok:true};}});
  assert.equal(result.ok,false); assert.equal(wrote,false);
});

test('repair engine execution fails closed when an injected capability throws', async()=>{
  const cases=[
    {discoverContext:async()=>{throw new Error('secret discovery failure');},callModel:async()=>'',writeRepair:async()=>({ok:true})},
    {discoverContext:async()=>({ok:true,context:[{path:'apps/web/app/page.tsx',content:'x'}]}),callModel:async()=>{throw new Error('secret model failure');},writeRepair:async()=>({ok:true})},
    {discoverContext:async()=>({ok:true,context:[{path:'apps/web/app/page.tsx',content:'x'}]}),callModel:async()=>JSON.stringify({cause:'safe',confidence:.9,files:[{path:'apps/web/app/page.tsx',content:'x'}]}),writeRepair:async()=>{throw new Error('secret writer failure');}},
  ];
  for(const capabilities of cases){
    const result=await executeRepairEngine({authenticated:true,mode:'allowlist',repair,request,...capabilities});
    assert.deepEqual(result,{ok:false,reason:'engine_failed'});
  }
});
