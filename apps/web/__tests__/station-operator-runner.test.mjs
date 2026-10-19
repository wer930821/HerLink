import test from 'node:test';
import assert from 'node:assert/strict';
import { runClaimedJobs } from '../lib/station-operator/runner.mjs';

function job(thread='t1'){ return {id:'j1',thread_id:thread,trigger_message_id:'m1',claim_token:'c1',attempt_count:1}; }

test('dry run records decision and safely finishes job without reply or repair', async () => {
  const calls=[];
  const db={
    async messages(){return[{sender_role:'user',body:'測試'}]},
    async latestUserMessage(){return'm1'},
    async audit(v){calls.push(['audit',v.action,v.outcome,v.details])},
    async replyAndFinish(){calls.push(['reply'])},
    async createBugRepair(){calls.push(['repair'])},
    async finish(v){calls.push(['finish',v])}
  };
  const results=await runClaimedJobs({jobs:[job()],db,mode:'dry_run',testThreads:new Set(),decide:async()=>({kind:'reply',reply:'回答',actions:[],confidence:.9,needsHuman:false})});
  assert.deepEqual(results,[{status:'dry_run'}]);
  assert.equal(calls.some(x=>['reply','repair'].includes(x[0])),false);
  assert.equal(calls.some(x=>x[0]==='audit'&&x[1]==='dry_run'),true);
  const finish=calls.find(x=>x[0]==='finish');
  assert.ok(finish);
  assert.deepEqual(finish[1],{jobId:'j1',claimToken:'c1',status:'completed',result:{mode:'dry_run'}});
});

test('dry run marks stale observation in audit and still safely finishes without reply', async () => {
  const calls=[];
  const db={
    async messages(){return[{sender_role:'user',body:'舊訊息'}]},
    async latestUserMessage(){return'm2'},
    async audit(v){calls.push(['audit',v])},
    async replyAndFinish(){calls.push(['reply'])},
    async createBugRepair(){calls.push(['repair'])},
    async finish(v){calls.push(['finish',v])}
  };
  const results=await runClaimedJobs({jobs:[job()],db,mode:'dry_run',testThreads:new Set(),decide:async()=>({kind:'reply',reply:'回答',actions:[],confidence:.8,needsHuman:false})});
  assert.deepEqual(results,[{status:'dry_run'}]);
  const audit=calls.find(x=>x[0]==='audit')?.[1];
  assert.equal(audit?.details?.stale,true);
  assert.equal(calls.some(x=>['reply','repair'].includes(x[0])),false);
  assert.equal(calls.some(x=>x[0]==='finish'),true);
});

test('allowlist refuses non-test thread without model call or mutation', async () => {
  let decided=false, mutated=false;
  const db={async audit(){},async finish(){mutated=true}};
  const results=await runClaimedJobs({jobs:[job('other')],db,mode:'allowlist',testThreads:new Set(['t1']),decide:async()=>{decided=true;return{}}});
  assert.deepEqual(results,[{status:'not_allowed'}]);
  assert.equal(decided,false);
  assert.equal(mutated,false);
});

test('production delegates allowed job to worker', async () => {
  let replied=false;
  const db={async messages(){return[]},async latestUserMessage(){return'm1'},async replyAndFinish(){replied=true},async audit(){},async finish(){}};
  const results=await runClaimedJobs({jobs:[job()],db,mode:'production',testThreads:new Set(),decide:async()=>({kind:'reply',reply:'ok',actions:[],confidence:1,needsHuman:false})});
  assert.equal(results[0].status,'completed');
  assert.equal(replied,true);
});
