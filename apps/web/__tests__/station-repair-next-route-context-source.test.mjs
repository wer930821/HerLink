import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/api/internal/station-repair/engine/route.ts',import.meta.url),'utf8');

test('internal repair route uses bounded repository context runtime instead of context placeholder',()=>{
  assert.match(source,/discoverRepairContext/);
  assert.doesNotMatch(source,/context_runtime_not_wired/);
});

test('internal repair route keeps GitHub writer fail closed until explicit write capability exists',()=>{
  assert.match(source,/github_writer_not_wired/);
});
