import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/api/internal/station-repair/engine/route.ts',import.meta.url),'utf8');

test('internal repair route wires constrained engine runtime instead of placeholder execution',()=>{
  assert.match(source,/buildRepairEngineRuntime/);
  assert.match(source,/executeRepairEngine/);
  assert.match(source,/callRepairModel/);
  assert.match(source,/discoverContext/);
  assert.doesNotMatch(source,/execute\s*:\s*async\s*\(\)\s*=>\s*\(\{ok:false,reason:['"]runtime_not_wired['"]\}\)/);
});

test('internal repair route keeps unwired external capabilities fail closed',()=>{
  assert.match(source,/context_runtime_not_wired/);
  assert.match(source,/github_writer_not_wired/);
});

test('internal repair route does not expose OpenAI key or add a new client credential',()=>{
  assert.doesNotMatch(source,/NEXT_PUBLIC_[A-Z0-9_]*OPENAI/);
  assert.doesNotMatch(source,/payload\.(?:apiKey|token|secret)/);
});
