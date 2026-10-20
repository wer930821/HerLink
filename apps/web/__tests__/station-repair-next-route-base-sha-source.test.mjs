import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/api/internal/station-repair/engine/route.ts',import.meta.url),'utf8');

test('internal repair route resolves immutable main SHA server-side',()=>{
  assert.match(source,/resolveBaseSha/);
  assert.match(source,/git\/ref\/heads\/main/);
  assert.match(source,/STATION_REPAIR_GITHUB_REPOSITORY/);
  assert.match(source,/STATION_REPAIR_GITHUB_TOKEN/);
});

test('base SHA resolver is passed to HTTP boundary and not accepted from payload',()=>{
  assert.match(source,/resolveBaseSha\s*:/);
  assert.doesNotMatch(source,/payload\.baseSha/);
});
