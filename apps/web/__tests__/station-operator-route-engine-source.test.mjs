import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const url=fileURLToPath(new URL('../app/api/internal/station-operator/route.ts',import.meta.url));
const source=fs.readFileSync(url,'utf8');

test('station operator route injects a repair engine into runner',()=>{
  assert.match(source,/repairEngine/);
  assert.match(source,/station-repair\/engine/);
});
