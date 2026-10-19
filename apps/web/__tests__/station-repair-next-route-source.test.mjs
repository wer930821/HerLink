import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const url=new URL('../app/api/internal/station-repair/engine/route.ts',import.meta.url);

test('internal repair engine route is node-only and delegates through fail-closed http boundary',()=>{
  const source=fs.readFileSync(url,'utf8');
  assert.match(source,/export const runtime\s*=\s*['"]nodejs['"]/);
  assert.match(source,/handleRepairEngineHttp/);
  assert.match(source,/createOperatorDb\(\)/);
  assert.match(source,/STATION_REPAIR_CALLBACK_SECRET/);
  assert.match(source,/STATION_OPERATOR_MODE/);
});

test('internal repair engine route parses json safely and never accepts repair trust fields from client',()=>{
  const source=fs.readFileSync(url,'utf8');
  assert.match(source,/await request\.json\(\)/);
  assert.match(source,/status:400/);
  assert.doesNotMatch(source,/payload\.(?:jobId|risk|status|attempt|summary|branch)/);
});
