import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairDispatch, buildRepairEngineRequest, validateRepairPlan, buildRepairPrSpec, buildRepairGitHubSteps, validateRepairBranchWrite } from '../lib/station-operator/repair-dispatch.mjs';

const FULL_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('builds an isolated ai-repair branch request from a low-risk queued repair', () => {
  const result=buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'queued',risk:'low',summary:'回覆訊息按鈕沒有反應'},attemptCount:1});
  assert.deepEqual(result,{ok:true,repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆訊息按鈕沒有反應',attempt:1});
});

test('fails closed for high-risk, non-queued, or over-limit repairs', () => {
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'queued',risk:'high',summary:'x'},attemptCount:1}).ok,false);
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'ci_running',risk:'low',summary:'x'},attemptCount:1}).ok,false);
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'j1',status:'queued',risk:'low',summary:'x'},attemptCount:3}).ok,false);
});

test('never places mailbox identifiers or unsafe branch text into branch name', () => {
  assert.equal(buildRepairDispatch({repair:{id:'r1',job_id:'../../main',thread_id:'secret-thread',status:'queued',risk:'low',summary:'x'},attemptCount:1}).ok,false);
});

test('builds a repair engine request without mailbox thread or raw messages', () => {
  const request=buildRepairEngineRequest({dispatch:{ok:true,repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆訊息按鈕沒有反應',attempt:1},repair:{thread_id:'private-thread',trigger_message_id:'private-message'},messages:[{body:'raw mailbox content'}]});
  assert.deepEqual(request,{repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆訊息按鈕沒有反應',attempt:1,allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/']});
  assert.doesNotMatch(JSON.stringify(request), /private-thread|private-message|raw mailbox content/);
});

test('repair engine request rejects invalid dispatch objects', () => assert.throws(()=>buildRepairEngineRequest({dispatch:{ok:false}}), /invalid repair dispatch/i));

test('accepts a small constrained repair plan containing only allowed app files', () => {
  const files=[{path:'apps/web/components/ReplyButton.tsx',content:'export function ReplyButton(){ return null; }'},{path:'apps/web/__tests__/reply-button.test.mjs',content:'// regression test'}];
  assert.deepEqual(validateRepairPlan({files}),{ok:true,files});
});

test('rejects repair plans that touch workflow, migration, secrets, operator safety code, or too many files', () => {
  for (const path of ['.github/workflows/pwn.yml','supabase/migrations/evil.sql','apps/web/.env.local','apps/web/lib/station-operator/worker.mjs','apps/web/app/api/internal/station-repair/callback/route.ts']) assert.equal(validateRepairPlan({files:[{path,content:'x'}]}).ok,false,path);
  assert.equal(validateRepairPlan({files:Array.from({length:6},(_,i)=>({path:`apps/web/components/F${i}.tsx`,content:'x'}))}).ok,false);
});

test('rejects empty, duplicate, oversized, or command-bearing repair plans', () => {
  assert.equal(validateRepairPlan({files:[]}).ok,false);
  assert.equal(validateRepairPlan({files:[{path:'apps/web/components/A.tsx',content:'x'},{path:'apps/web/components/A.tsx',content:'y'}]}).ok,false);
  assert.equal(validateRepairPlan({files:[{path:'apps/web/components/A.tsx',content:'x'.repeat(50001)}]}).ok,false);
  assert.equal(validateRepairPlan({files:[{path:'apps/web/components/A.tsx',content:'```sh\nrm -rf /\n```'}]}).ok,false);
});

test('builds a draft PR spec only from a validated repair request and plan', () => {
  const request={repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆按鈕沒有反應',attempt:1,allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/']};
  const plan=validateRepairPlan({files:[{path:'apps/web/components/ReplyButton.tsx',content:'export const fixed=true;'}]});
  assert.deepEqual(buildRepairPrSpec({request,plan}),{branch:'ai-repair/j1',base:'main',draft:true,title:'fix: automated repair j1',body:'Automated low-risk repair.\n\nRepair: r1\nAttempt: 1\n\nRequires CI validation before any merge.',files:[{path:'apps/web/components/ReplyButton.tsx',content:'export const fixed=true;'}]});
});

test('repair PR spec fails closed for invalid plan, non-ai branch, or attempt over limit', () => {
  const base={repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'x',attempt:1,allowedRoots:[]};
  assert.throws(()=>buildRepairPrSpec({request:base,plan:{ok:false}}), /invalid repair pr/i);
  assert.throws(()=>buildRepairPrSpec({request:{...base,branch:'main'},plan:{ok:true,files:[{path:'apps/web/components/A.tsx',content:'x'}]}}), /invalid repair pr/i);
  assert.throws(()=>buildRepairPrSpec({request:{...base,attempt:3},plan:{ok:true,files:[{path:'apps/web/components/A.tsx',content:'x'}]}}), /invalid repair pr/i);
});

test('builds deterministic GitHub execution steps without merge or direct main writes', () => {
  const spec={branch:'ai-repair/j1',base:'main',draft:true,title:'fix: automated repair j1',body:'safe',files:[{path:'apps/web/components/A.tsx',content:'x'}]};
  assert.deepEqual(buildRepairGitHubSteps({spec,baseSha:FULL_SHA}),[{action:'create_branch',branch:'ai-repair/j1',from:FULL_SHA},{action:'write_file',branch:'ai-repair/j1',path:'apps/web/components/A.tsx',content:'x'},{action:'create_pull_request',head:'ai-repair/j1',base:'main',draft:true,title:'fix: automated repair j1',body:'safe'}]);
});

test('GitHub execution steps require exactly a full 40-character hexadecimal base sha', () => {
  const safe={branch:'ai-repair/j1',base:'main',draft:true,title:'fix: automated repair j1',body:'safe',files:[{path:'apps/web/components/A.tsx',content:'x'}]};
  assert.doesNotThrow(()=>buildRepairGitHubSteps({spec:safe,baseSha:FULL_SHA}));
  for (const sha of ['abc123','a'.repeat(39),'a'.repeat(41),'g'.repeat(40)]) assert.throws(()=>buildRepairGitHubSteps({spec:safe,baseSha:sha}), /invalid github repair/i, sha);
});

test('GitHub execution steps reject main branch, non-draft PR, invalid base sha, and unsafe files', () => {
  const safe={branch:'ai-repair/j1',base:'main',draft:true,title:'fix: automated repair j1',body:'safe',files:[{path:'apps/web/components/A.tsx',content:'x'}]};
  assert.throws(()=>buildRepairGitHubSteps({spec:{...safe,branch:'main'},baseSha:FULL_SHA}), /invalid github repair/i);
  assert.throws(()=>buildRepairGitHubSteps({spec:{...safe,draft:false},baseSha:FULL_SHA}), /invalid github repair/i);
  assert.throws(()=>buildRepairGitHubSteps({spec:safe,baseSha:'../../main'}), /invalid github repair/i);
  assert.throws(()=>buildRepairGitHubSteps({spec:{...safe,files:[{path:'.github/workflows/x.yml',content:'x'}]},baseSha:FULL_SHA}), /invalid github repair/i);
});

test('allows writes only to the exact isolated ai-repair job branch', () => {
  assert.deepEqual(validateRepairBranchWrite({jobId:'j1',branch:'ai-repair/j1'}),{ok:true,branch:'ai-repair/j1'});
});

test('branch write gate rejects main, another repair branch, malformed job IDs, and force updates', () => {
  assert.equal(validateRepairBranchWrite({jobId:'j1',branch:'main'}).ok,false);
  assert.equal(validateRepairBranchWrite({jobId:'j1',branch:'ai-repair/j2'}).ok,false);
  assert.equal(validateRepairBranchWrite({jobId:'../main',branch:'ai-repair/../main'}).ok,false);
  assert.equal(validateRepairBranchWrite({jobId:'j1',branch:'ai-repair/j1',force:true}).ok,false);
});
