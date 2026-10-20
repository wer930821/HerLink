import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config=fs.readFileSync(new URL('../next.config.mjs',import.meta.url),'utf8');

test('Next server trace explicitly bundles approved repair source roots for production runtime',()=>{
  assert.match(config,/outputFileTracingIncludes/);
  assert.match(config,/station-repair\/engine/);
  assert.match(config,/app\/\*\*\/\*/);
  assert.match(config,/components\/\*\*\/\*/);
  assert.match(config,/lib\/\*\*\/\*/);
  assert.match(config,/__tests__\/\*\*\/\*/);
});

test('repair source bundle does not include repository control or migration roots',()=>{
  const tracing=config.match(/outputFileTracingIncludes[\s\S]*?(?=\n\s*env:)/)?.[0] ?? '';
  assert.doesNotMatch(tracing,/\.github/);
  assert.doesNotMatch(tracing,/supabase\/migrations/);
});
