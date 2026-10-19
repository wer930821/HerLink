import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairModelRequest, parseRepairModelOutput, prepareValidatedRepairPlan } from '../lib/station-operator/repair-engine.mjs';

const request={repairId:'r1',jobId:'j1',branch:'ai-repair/j1',summary:'回覆按鈕沒有反應',attempt:1,allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/']};
const context=[{path:'apps/web/app/session/[id]/page.tsx',content:'export default function Page(){ return null; }'}];

test('model request treats bug summary and repository context as untrusted data',()=>{
  const result=buildRepairModelRequest({request,context});
  assert.equal(result.ok,true);
  assert.match(result.system,/untrusted data/i);
  assert.doesNotMatch(result.system,/回覆按鈕沒有反應/);
  assert.equal(result.input.summary,'回覆按鈕沒有反應');
  assert.deepEqual(result.input.context,context);
});

test('parser accepts JSON-only structured repair output',()=>{
  const raw=JSON.stringify({cause:'click handler does not dispatch event',confidence:0.9,files:[{path:'apps/web/app/session/[id]/page.tsx',content:'export default function Page(){ return null; }'}]});
  const parsed=parseRepairModelOutput(raw);
  assert.equal(parsed.ok,true);
  assert.equal(parsed.plan.cause,'click handler does not dispatch event');
});

test('parser rejects malformed, fenced, command-bearing, and ambiguous output',()=>{
  assert.equal(parseRepairModelOutput('{bad').ok,false);
  assert.equal(parseRepairModelOutput('```json\n{}\n```').ok,false);
  assert.equal(parseRepairModelOutput(JSON.stringify({cause:'x',confidence:0.9,command:'rm -rf /',files:[]})).ok,false);
  assert.equal(parseRepairModelOutput(JSON.stringify({cause:'unknown',confidence:0.2,files:[{path:'apps/web/app/a.tsx',content:'x'}]})).ok,false);
});

test('validated plan fails closed when any proposed file is forbidden',()=>{
  const result=prepareValidatedRepairPlan({raw:JSON.stringify({cause:'x',confidence:0.9,files:[{path:'apps/web/app/a.tsx',content:'x'},{path:'.github/workflows/pwn.yml',content:'x'}]})});
  assert.equal(result.ok,false);
});

test('validated plan accepts a bounded safe repair',()=>{
  const result=prepareValidatedRepairPlan({raw:JSON.stringify({cause:'reply handler bug',confidence:0.9,files:[{path:'apps/web/app/session/[id]/page.tsx',content:'export const fixed=true;'}]})});
  assert.deepEqual(result,{ok:true,cause:'reply handler bug',confidence:0.9,files:[{path:'apps/web/app/session/[id]/page.tsx',content:'export const fixed=true;'}]});
});
