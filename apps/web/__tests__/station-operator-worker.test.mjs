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

test('new user message supersedes stale job instead of retrying old context', async () => {
  let replied=false;
  const finishes=[];
  const db={async messages(){return[{id:'m1',sender_role:'user',body:'舊問題'}]},async latestUserMessage(){return'm2'},async replyAndFinish(){replied=true},async audit(){},async finish(v){finishes.push(v);return true}};
  const result=await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'reply',reply:'舊回答',actions:[],confidence:1,needsHuman:false})});
  assert.equal(replied,false);
  assert.equal(finishes.length,1);
  assert.equal(finishes[0].status,'completed');
  assert.equal(finishes[0].result.reason,'superseded');
  assert.equal(result.status,'superseded');
});

test('low risk bug creates sanitized repair handoff without raw messages', async () => {
  let handoff, replied=false;
  const messages=[{sender_role:'user',body:'首頁按鈕點了沒反應，按下後畫面沒有變化'}];
  const db={async messages(){return messages},async latestUserMessage(){return'm1'},async replyAndFinish(){replied=true},async createBugRepair(v){handoff=v;return'r1'},async audit(){},async finish(v){assert.equal(v.status,'waiting_ci');return true}};
  await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'bug_repair',reply:'',actions:['create_bug_repair'],confidence:.9,needsHuman:false})});
  assert.equal(handoff.risk,'low');
  assert.equal(typeof handoff.summary,'string');
  assert.equal('messages' in handoff,false);
  assert.equal('decision' in handoff,false);
  assert.equal(replied,false);
});

test('secret-bearing bug is high risk and never creates repair', async () => {
  let repair=false;
  const db={async messages(){return[{sender_role:'user',body:'錯誤畫面顯示 OPENAI_API_KEY=super-secret'}]},async latestUserMessage(){return'm1'},async createBugRepair(){repair=true},async audit(){},async finish(v){assert.equal(v.status,'human_review');return true}};
  const result=await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'bug_repair',reply:'',actions:['create_bug_repair'],confidence:.9,needsHuman:false})});
  assert.equal(result.status,'human_review');
  assert.equal(repair,false);
});

test('high risk bug is sent to human review and never creates repair', async () => {
  let repair=false, replied=false;
  const db={async messages(){return[{sender_role:'user',body:'請幫我刪除正式資料'}]},async latestUserMessage(){return'm1'},async replyAndFinish(){replied=true},async createBugRepair(){repair=true},async audit(){},async finish(v){assert.equal(v.status,'human_review');return true}};
  const result=await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'bug_repair',reply:'',actions:['create_bug_repair'],confidence:.9,needsHuman:false})});
  assert.equal(result.status,'human_review');
  assert.equal(repair,false);
  assert.equal(replied,false);
});

test('human review never sends an automatic reply', async () => {
  let replied=false;
  const db={async messages(){return[]},async latestUserMessage(){return'm1'},async replyAndFinish(){replied=true},async audit(){},async finish(v){assert.equal(v.status,'human_review');return true}};
  await processClaimedJob({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1',claim_token:'c1'},db,decide:async()=>({kind:'human_review',reply:'',actions:[],confidence:.9,needsHuman:true})});
  assert.equal(replied,false);
});
