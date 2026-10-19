import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverRepairContext } from '../lib/station-operator/repair-context-runtime.mjs';

test('discovers a bounded set of approved repository files and returns their contents',async()=>{
  const searched=[];
  const read=[];
  const result=await discoverRepairContext({
    summary:'reply button does nothing in session chat',
    allowedRoots:['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/'],
    search:async query=>{searched.push(query);return ['apps/web/app/session/[id]/page.tsx','apps/web/components/chat/ReplyButton.tsx'];},
    readFile:async path=>{read.push(path);return path.endsWith('page.tsx')?'export default function Page(){}':'export function ReplyButton(){}';}
  });
  assert.equal(result.ok,true);
  assert.equal(result.context.length,2);
  assert.deepEqual(read,['apps/web/app/session/[id]/page.tsx','apps/web/components/chat/ReplyButton.tsx']);
  assert.equal(searched.length,1);
});

test('fails closed when discovery returns forbidden paths, too many files, or oversized content',async()=>{
  const forbidden=await discoverRepairContext({summary:'reply bug',allowedRoots:['apps/web/app/'],search:async()=>['.github/workflows/x.yml'],readFile:async()=>''});
  assert.equal(forbidden.ok,false);
  const many=await discoverRepairContext({summary:'reply bug',allowedRoots:['apps/web/app/'],search:async()=>Array.from({length:6},(_,i)=>`apps/web/app/x${i}.tsx`),readFile:async()=>''});
  assert.equal(many.ok,false);
  const huge=await discoverRepairContext({summary:'reply bug',allowedRoots:['apps/web/app/'],search:async()=>['apps/web/app/x.tsx'],readFile:async()=> 'x'.repeat(120001)});
  assert.equal(huge.ok,false);
});

test('never reads files outside the caller allowed roots even if repository guard would otherwise allow them',async()=>{
  let reads=0;
  const result=await discoverRepairContext({summary:'reply bug',allowedRoots:['apps/web/app/'],search:async()=>['apps/web/lib/helper.ts'],readFile:async()=>{reads++;return 'x';}});
  assert.equal(result.ok,false);
  assert.equal(reads,0);
});
