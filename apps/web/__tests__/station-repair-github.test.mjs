import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairGitHubWriteRequest, executeRepairGitHubWrite } from '../lib/station-operator/repair-github.mjs';

const baseSha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const files=[{path:'apps/web/app/session/[id]/page.tsx',content:'export const fixed=true;'}];
const jobId='123e4567-e89b-12d3-a456-426614174000';

test('builds an isolated draft-pr write request for a safe repair',()=>{
  const result=buildRepairGitHubWriteRequest({jobId,baseSha,files,cause:'reply handler bug'});
  assert.equal(result.ok,true);
  assert.equal(result.request.branch,`ai-repair/${jobId}`);
  assert.equal(result.request.baseSha,baseSha);
  assert.equal(result.request.base,'main');
  assert.equal(result.request.draft,true);
  assert.equal(result.request.force,false);
  assert.deepEqual(result.request.files,files);
});

test('fails closed for main, wrong branch, force, unsafe files, and invalid sha',()=>{
  for (const overrides of [
    {branch:'main'},
    {branch:'ai-repair/other'},
    {force:true},
    {baseSha:'abc123'},
    {files:[{path:'.github/workflows/pwn.yml',content:'x'}]},
  ]) {
    assert.equal(buildRepairGitHubWriteRequest({jobId,baseSha,files,cause:'x',...overrides}).ok,false);
  }
});

test('requires UUID job identity for autonomous repair branches',()=>{
  for (const invalid of ['job-1','../main','123e4567-e89b-12d3-a456-42661417400','123e4567-e89b-12d3-a456-426614174000-extra']) {
    assert.equal(buildRepairGitHubWriteRequest({jobId:invalid,baseSha,files,cause:'x'}).ok,false);
  }
});

test('does not accept arbitrary executor commands, mutation targets, scripts, refs, or executable hooks',()=>{
  for (const overrides of [
    {command:'git push --force'},
    {target:'refs/heads/main'},
    {ref:'refs/heads/main'},
    {script:'rm -rf .'},
    {shell:'bash'},
    {exec:'git push'},
  ]) {
    assert.equal(buildRepairGitHubWriteRequest({jobId,baseSha,files,cause:'x',...overrides}).ok,false);
  }
});

test('cannot downgrade draft safety or redirect the PR base away from main',()=>{
  assert.equal(buildRepairGitHubWriteRequest({jobId,baseSha,files,cause:'x',draft:false}).ok,false);
  assert.equal(buildRepairGitHubWriteRequest({jobId,baseSha,files,cause:'x',base:'release'}).ok,false);
});

test('sanitizes control characters from untrusted PR cause text',()=>{
  const result=buildRepairGitHubWriteRequest({jobId,baseSha,files,cause:'reply bug\n\r\tOPENAI_API_KEY=fake'});
  assert.equal(result.ok,true);
  assert.equal(/[\r\n\t]/.test(result.request.body),false);
});

test('capability-limited writer creates exact isolated branch, writes validated files, and opens draft PR',async()=>{
  const calls=[];
  const capabilities={
    createBranch:async input=>{calls.push(['branch',input]);return{ok:true};},
    writeFiles:async input=>{calls.push(['files',input]);return{ok:true,commitSha:'b'.repeat(40)};},
    createDraftPr:async input=>{calls.push(['pr',input]);return{ok:true,prNumber:77};},
  };
  const result=await executeRepairGitHubWrite({jobId,baseSha,files,cause:'reply handler bug'},capabilities);
  assert.deepEqual(result,{ok:true,branch:`ai-repair/${jobId}`,prNumber:77,commitSha:'b'.repeat(40)});
  assert.deepEqual(calls.map(call=>call[0]),['branch','files','pr']);
  assert.deepEqual(calls[0][1],{branch:`ai-repair/${jobId}`,baseSha});
  assert.equal(calls[1][1].branch,`ai-repair/${jobId}`);
  assert.deepEqual(calls[1][1].files,files);
  assert.equal(calls[2][1].head,`ai-repair/${jobId}`);
  assert.equal(calls[2][1].base,'main');
  assert.equal(calls[2][1].draft,true);
});

test('capability-limited writer fails closed before side effects for unsafe requests or missing capabilities',async()=>{
  let touched=false;
  const capabilities={createBranch:async()=>{touched=true;},writeFiles:async()=>{touched=true;},createDraftPr:async()=>{touched=true;}};
  assert.equal((await executeRepairGitHubWrite({jobId,baseSha,files:[{path:'.github/workflows/pwn.yml',content:'x'}],cause:'x'},capabilities)).ok,false);
  assert.equal(touched,false);
  assert.equal((await executeRepairGitHubWrite({jobId,baseSha,files,cause:'x'},{createBranch:async()=>({ok:true})})).ok,false);
});

test('capability-limited writer stops on branch, file, or PR failure without continuing',async()=>{
  for (const failAt of ['branch','files','pr']) {
    const calls=[];
    const capabilities={
      createBranch:async()=>{calls.push('branch');return failAt==='branch'?{ok:false}:{ok:true};},
      writeFiles:async()=>{calls.push('files');return failAt==='files'?{ok:false}:{ok:true,commitSha:'b'.repeat(40)};},
      createDraftPr:async()=>{calls.push('pr');return failAt==='pr'?{ok:false}:{ok:true,prNumber:77};},
    };
    const result=await executeRepairGitHubWrite({jobId,baseSha,files,cause:'x'},capabilities);
    assert.equal(result.ok,false);
    const expected=failAt==='branch'?['branch']:failAt==='files'?['branch','files']:['branch','files','pr'];
    assert.deepEqual(calls,expected);
  }
});
