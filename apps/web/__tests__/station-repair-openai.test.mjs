import test from 'node:test';
import assert from 'node:assert/strict';
import { callRepairModel } from '../lib/station-operator/repair-openai.mjs';

function response(body,{ok=true,status=200}={}) { return {ok,status,json:async()=>body}; }

test('repair model uses server-side Responses API and returns output text only',async()=>{
  let request;
  const fetchImpl=async(url,init)=>{request={url,init};return response({output_text:'{"cause":"x","confidence":0.9,"files":[]}'});};
  const raw=await callRepairModel({modelRequest:{ok:true,system:'system',input:{summary:'bug'}},fetchImpl,apiKey:'server-key',model:'test-model'});
  assert.equal(raw,'{"cause":"x","confidence":0.9,"files":[]}');
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  assert.equal(request.init.headers.Authorization,'Bearer server-key');
  const body=JSON.parse(request.init.body);
  assert.equal(body.model,'test-model');
  assert.equal(body.instructions,'system');
  assert.match(body.input,/"summary":"bug"/);
});

test('repair model requires server api key and fails closed on unsafe OpenAI errors',async()=>{
  await assert.rejects(()=>callRepairModel({modelRequest:{ok:true,system:'x',input:{}},apiKey:''}),/OPENAI_API_KEY missing/);
  const fetchImpl=async()=>response({error:{message:'secret leaked',type:'server_error',code:'bad_request'}},{ok:false,status:500});
  await assert.rejects(()=>callRepairModel({modelRequest:{ok:true,system:'x',input:{}},fetchImpl,apiKey:'server-key'}),error=>{
    assert.match(error.message,/OpenAI 500 server_error bad_request/);
    assert.doesNotMatch(error.message,/secret leaked/);
    return true;
  });
});

test('repair model rejects malformed model requests before network access',async()=>{
  let called=false;
  await assert.rejects(()=>callRepairModel({modelRequest:{ok:false},fetchImpl:async()=>{called=true;},apiKey:'server-key'}),/invalid repair model request/);
  assert.equal(called,false);
});
