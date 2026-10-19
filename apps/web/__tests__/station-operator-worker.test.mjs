import test from 'node:test';
import assert from 'node:assert/strict';
import { processClaimedJob } from '../lib/station-operator/worker.mjs';

test('safe reply uses atomic reply-and-finish exactly once', async () => {
  const calls=[];
  const db={
    async messages(){ return [{id:'m1',sender_role:'user',body:'怎麼恢復聊天室？'}]; },
    async latestUserMessage(){ return 'm1'; },
    async replyAndFinish(v){ calls.push(['replyAndFinish',v]); },
    async audit(v){ calls.push(['audit',v.action]); },
    async finish(v){ calls.push(['finish',v.status]); return true; }
  };
  const decide=async()=>({kind:'reply',reply:'可以使用恢復碼接回。',actions:[],confidence:.95,needsHuman:false});
  await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide});
  const replies=calls.filter(x=>x[0]==='replyAndFinish');
  assert.equal(replies.length,1);
  assert.equal(replies[0][1].body,'可以使用恢復碼接回。');
  assert.equal(calls.some(x=>x[0]==='finish'),false);
});

test('new user message during processing defers instead of replying stale context', async () => {
  let replied=false;
  const db={async messages(){return[{id:'m1',sender_role:'user',body:'舊問題'}]},async latestUserMessage(){return'm2'},async replyAndFinish(){replied=true},async audit(){},async finish(v){assert.equal(v.status,'pending');return true}};
  await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'reply',reply:'舊回答',actions:[],confidence:1,needsHuman:false})});
  assert.equal(replied,false);
});

test('bug report creates repair handoff without sending a reply', async () => {
  let repair=false, replied=false;
  const db={async messages(){return[]},async latestUserMessage(){return'm1'},async replyAndFinish(){replied=true},async createBugRepair(){repair=true},async audit(){},async finish(v){assert.equal(v.status,'waiting_ci');return true}};
  await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'bug_repair',reply:'',actions:['create_bug_repair'],confidence:.9,needsHuman:false})});
  assert.equal(repair,true); assert.equal(replied,false);
});

test('human review never sends an automatic reply', async () => {
  let replied=false;
  const db={async messages(){return[]},async latestUserMessage(){return'm1'},async replyAndFinish(){replied=true},async audit(){},async finish(v){assert.equal(v.status,'human_review');return true}};
  await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'human_review',reply:'',actions:[],confidence:.9,needsHuman:true})});
  assert.equal(replied,false);
});
