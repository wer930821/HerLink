const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const anon = load('lib/anonymous.ts');

test('anonymous fallbacks never use real display names or biographies', () => {
  const profile = { display_name: 'Private Real Name', bio: 'private@example.com' };
  assert.equal(anon.getSafeAnonymousDisplayName(profile), '匿名使用者');
  assert.equal(anon.getVisibleProfileBio(profile), '');
});

test('client alias validation matches the 2 to 12 character contract', () => {
  assert.equal(anon.validateAnonymousDisplayName('阿鵝'), null);
  assert.equal(anon.validateAnonymousDisplayName('abcdefghijkl'), null);
  assert.equal(anon.validateAnonymousDisplayName('abcdefghijklm'), '名稱最多 12 個字');
  assert.equal(anon.validateAnonymousDisplayName('鵝'), '名稱至少需要 2 個字');
  assert.equal(anon.validateAnonymousDisplayName('  \n  '), '名稱格式不正確');
});

test('concurrent profile bootstrap reads the winning row without overwriting its alias', async () => {
  const existing = { id: 'self', anonymous_display_name: 'Already Saved', account_status: 'active' };
  let reads = 0;
  const client = { rpc: async () => ({ data: [{ status: 'OK', anonymous_display_name: 'Already Saved' }], error: null }), from: () => ({
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    upsert(values, options) { assert.equal(options.ignoreDuplicates, true); reads++; return this; },
    single: async () => ({ data: existing, error: null }),
  }) };
  const { ensureAnonymousBootstrapProfile } = load('lib/anonymous-profile.ts', { './supabase': { supabase: client } });
  const result = await ensureAnonymousBootstrapProfile('self');
  assert.equal(reads, 1);
  assert.equal(result.data.anonymous_display_name, 'Already Saved');
});
