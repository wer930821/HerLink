import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairGitHubWriteRequest } from '../lib/station-operator/repair-github.mjs';

const baseSha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const files=[{path:'apps/web/app/session/[id]/page.tsx',content:'export const fixed=true;'}];

test('builds an isolated draft-pr write request for a safe repair',()=>{
  const result=buildRepairGitHubWriteRequest({jobId:'123e4567-e89b-12d3-a456-426614174000',baseSha,files,cause:'reply handler bug'});
  assert.equal(result.ok,true);
  assert.equal(result.request.branch,'ai-repair/123e4567-e89b-12d3-a456-426614174000');
  assert.equal(result.request.baseSha,baseSha);
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
    assert.equal(buildRepairGitHubWriteRequest({jobId:'123e4567-e89b-12d3-a456-426614174000',baseSha,files,cause:'x',...overrides}).ok,false);
  }
});

test('does not accept arbitrary executor commands or mutation targets',()=>{
  assert.equal(buildRepairGitHubWriteRequest({jobId:'123e4567-e89b-12d3-a456-426614174000',baseSha,files,cause:'x',command:'git push --force'}).ok,false);
  assert.equal(buildRepairGitHubWriteRequest({jobId:'123e4567-e89b-12d3-a456-426614174000',baseSha,files,cause:'x',target:'refs/heads/main'}).ok,false);
});
