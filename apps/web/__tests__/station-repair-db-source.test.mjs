import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../lib/station-operator/db.ts',import.meta.url),'utf8');

test('operator db exposes a bounded single-repair lookup for the internal repair engine',()=>{
  assert.match(source,/repair:\s*async\s*\(repairId:string\)/);
  assert.match(source,/from\('station_operator_repairs'\)/);
  assert.match(source,/\.eq\('id',repairId\)/);
  assert.match(source,/\.maybeSingle\(\)/);
});

test('repair lookup selects only fields required by the engine trust boundary',()=>{
  const match=source.match(/repair:\s*async\s*\(repairId:string\)[\s\S]*?return data;/);
  assert.ok(match,'repair lookup implementation missing');
  assert.match(match[0],/select\('id,job_id,risk,status,attempt_count,summary'\)/);
  assert.doesNotMatch(match[0],/select\('\*'\)/);
});
