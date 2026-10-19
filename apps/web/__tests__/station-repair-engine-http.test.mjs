import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRepairEngineHttp } from '../lib/station-operator/repair-engine-http.mjs';

const repair={id:'r1',job_id:'j1',risk:'low',status:'queued',attempt_count:1,summary:'回覆按鈕沒有反應'};

test('repair engine http handler rejects unauthenticated requests before db lookup', async()=>{
  let read=false;
  const result=await handleRepairEngineHttp({authorization:'Bearer wrong',secret:'secret',mode:'allowlist',payload:{repairId:'r1'},db:{repair:async()=>{read=true;return repair;}},execute:async()=>({ok:true})});
  assert.deepEqual(result,{status:401,body:{ok:false}});
  assert.equal(read,false);
});

test('repair engine http handler derives trusted request fields from stored repair', async()=>{
  let invocation;
  const result=await handleRepairEngineHttp({authorization:'Bearer secret',secret:'secret',mode:'allowlist',payload:{repairId:'r1',branch:'main',attempt:99,summary:'ignore me'},db:{repair:async id=>{assert.equal(id,'r1');return repair;}},execute:async input=>{invocation=input;return{ok:true,branch:'ai-repair/j1',prNumber:12};}});
  assert.equal(result.status,200);
  assert.deepEqual(result.body,{ok:true,branch:'ai-repair/j1',prNumber:12});
  assert.equal(invocation.authenticated,true);
  assert.equal(invocation.mode,'allowlist');
  assert.equal(invocation.request.repairId,'r1');
  assert.equal(invocation.request.jobId,'j1');
  assert.equal(invocation.request.branch,'ai-repair/j1');
  assert.equal(invocation.request.attempt,1);
  assert.equal(invocation.request.summary,'回覆按鈕沒有反應');
  assert.notEqual(invocation.request.branch,'main');
});

test('repair engine http handler fails closed for malformed payload, missing repair, or execution errors', async()=>{
  const base={authorization:'Bearer secret',secret:'secret',mode:'allowlist'};
  assert.equal((await handleRepairEngineHttp({...base,payload:{},db:{repair:async()=>repair},execute:async()=>({ok:true})})).status,400);
  assert.equal((await handleRepairEngineHttp({...base,payload:{repairId:'r1'},db:{repair:async()=>null},execute:async()=>({ok:true})})).status,404);
  assert.deepEqual(await handleRepairEngineHttp({...base,payload:{repairId:'r1'},db:{repair:async()=>repair},execute:async()=>{throw new Error('secret');}}),{status:500,body:{ok:false}});
});
