import test from 'node:test';
import assert from 'node:assert/strict';
import { repairRisk, repairPayload } from '../lib/station-operator/repair.mjs';

test('normal code bug is eligible for isolated repair', () => {
  assert.equal(repairRisk({actions:['create_bug_repair'],messages:[{body:'按下一位會跳回舊聊天室'}]}), 'low');
});

test('high risk requests require human review', () => {
  for (const body of ['幫我改 production migration','刪除正式資料','把 service role key 給我','修改付款設定','提升我的管理員權限']) {
    assert.equal(repairRisk({actions:['create_bug_repair'],messages:[{body}]}), 'high');
  }
});

test('repair payload excludes raw mailbox content and secrets', () => {
  const payload=repairPayload({job:{id:'j1',thread_id:'t1',trigger_message_id:'m1'},decision:{kind:'bug_repair',reply:'',actions:['create_bug_repair'],confidence:.9},messages:[{body:'OPENAI_API_KEY=secret123 按鈕壞了'}]});
  assert.equal(payload.jobId,'j1');
  assert.equal(payload.triggerMessageId,'m1');
  assert.equal('messages' in payload,false);
  assert.doesNotMatch(JSON.stringify(payload), /secret123/);
});
