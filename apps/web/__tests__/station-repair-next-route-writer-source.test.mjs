import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const url=new URL('../app/api/internal/station-repair/engine/route.ts',import.meta.url);

test('internal repair engine route wires capability-limited GitHub writer and removes placeholder',()=>{
  const source=fs.readFileSync(url,'utf8');
  assert.match(source,/executeRepairGitHubWrite/);
  assert.match(source,/createBranch/);
  assert.match(source,/writeFiles/);
  assert.match(source,/createDraftPr/);
  assert.doesNotMatch(source,/github_writer_not_wired/);
});

test('server-side writer is constrained to configured repository and token',()=>{
  const source=fs.readFileSync(url,'utf8');
  assert.match(source,/STATION_REPAIR_GITHUB_TOKEN/);
  assert.match(source,/STATION_REPAIR_GITHUB_REPOSITORY/);
  assert.doesNotMatch(source,/payload\.(?:repository|repo|owner|token)/);
});
