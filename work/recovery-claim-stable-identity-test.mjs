import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('supabase/functions/anonymous-recovery-claim/index.ts', 'utf8');

assert.match(source, /resolve_active_anonymous_chat_identity/, 'claim must resolve the active anonymous identity');
assert.match(source, /currentIdentityId|anonymousIdentityId/, 'claim must keep a resolved stable identity id');
assert.doesNotMatch(source, /\.eq\("id",\s*user\.id\)\.maybeSingle\(\)/, 'claim must not validate only the raw auth uid profile');

console.log('recovery claim stable identity regression passed');
