import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMailboxThread } from '../lib/station-operator/openai.mjs';

test('uses Responses API and validates structured decision', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = {url, init};
    return { ok:true, json:async()=>({output_text:JSON.stringify({kind:'reply',reply:'收到，我幫妳確認。',actions:[],confidence:.9,needsHuman:false})}) };
  };
  const result = await decideMailboxThread({messages:[{sender_role:'user',body:'聊天室不見了'}],fetchImpl,apiKey:'test'});
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(result.kind, 'reply');
  assert.match(JSON.parse(request.init.body).instructions, /不可信/);
});

test('fails closed when OpenAI fails', async () => {
  const fetchImpl = async () => ({ok:false,status:500});
  await assert.rejects(()=>decideMailboxThread({messages:[],fetchImpl,apiKey:'test'}), /OpenAI 500/);
});
