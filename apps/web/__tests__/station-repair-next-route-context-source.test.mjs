import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/api/internal/station-repair/engine/route.ts',import.meta.url),'utf8');

test('internal repair route uses bounded repository context runtime instead of context placeholder',()=>{
  assert.match(source,/discoverRepairContext/);
  assert.doesNotMatch(source,/context_runtime_not_wired/);
});

test('internal repair route uses the explicit capability-limited GitHub writer',()=>{
  assert.match(source,/executeRepairGitHubWrite/);
  assert.match(source,/githubCapabilities/);
  assert.doesNotMatch(source,/github_writer_not_wired/);
});

test('repair source runtime resolves and contains paths under the deployed web root',()=>{
  assert.match(source,/path\.resolve/);
  assert.match(source,/path\.relative/);
  assert.match(source,/outside_source_root/);
});

test('repair source traversal is deterministic and skips files over 50KB before reading them',()=>{
  assert.match(source,/MAX_SOURCE_FILE_BYTES\s*=\s*50000/);
  assert.match(source,/\.sort\(/);
  assert.match(source,/fs\.stat/);
});
