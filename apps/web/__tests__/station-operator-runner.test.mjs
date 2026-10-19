import test from 'node:test';
import assert from 'node:assert/strict';
import { runClaimedJobs } from '../lib/station-operator/runner.mjs';

function job(thread='t1'){ return {id:'j1',thread_id:thread,trigger_message_id:'m1',claim_token:'c1',attempt_count:1}; }

test('dry run records decision but never replies, repairs, or finishes job', async () => {
  const calls=[];
  const db={
    async messages(){return[{sender_role:'user',body:'測試'}]},
    async latestUserMessage(){return'm1'},
    async audit(v){calls.push(['audit',v.action,v.outcome])},
    async replyAndFinish(){calls.push(['reply'])},
    async createBugRepair(){calls.push(['repair'])},
    async finish(){calls.push(['finish'])}
  };
  const results=await runClaimedJobs({jobs:[job()],db,mode:'dry_run',testThreads:new Set(),decide:async()=>({kind:'reply',reply:'回答',actions:[],confidence:.9,needsHuman:false})});
  assert.deepEqual(results,[{status:'dry_run'}]);
  assert.equal(calls.some(x=>['reply','repair','finish'].includes(x[0])),false);
  assert.equal(calls.some(x=>x[0]==='audit'&&x[1]==='dry_run'),true);
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
