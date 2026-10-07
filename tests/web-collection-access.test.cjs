const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '../apps/web/app/collection/page.tsx'), 'utf8');

test('collection game state loads for every visitor instead of only tester', () => {
  assert.match(page, /useEffect\(\(\)=>\{void load\(\)\},\[load\]\)/);
  assert.doesNotMatch(page, /if\(isTester\)void load\(\);else if\(isTester===false\)setLoading\(false\)/);
});

test('normal users are not replaced by a hero-only collection page', () => {
  assert.doesNotMatch(page, /if\(!isTester\)return <main className="collection-page">/);
});
