const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('shared Google auth keeps anonymous identity by linking when a session exists', () => {
  const source = read('lib/account.ts');
  assert.match(source, /linkIdentity\(\{\s*provider:\s*["']google["']/);
  assert.match(source, /signInWithOAuth\(\{\s*provider:\s*["']google["']/);
  assert.match(source, /user\?\.is_anonymous|user\.is_anonymous/);
  assert.match(source, /getAuthCallbackUrl\(\)/);
});

test('Google auth never signs out on cancellation or callback errors', () => {
  const source = read('lib/account.ts');
  assert.doesNotMatch(source, /catch[\s\S]{0,500}signOut\(\)/);
  assert.match(source, /cancel|dismiss|callback/i);
});

test('mobile login uses the HerLink deep-link callback and preserves email login', () => {
  const login = read('app/account-login.tsx');
  const account = read('lib/account.ts');
  const supabase = read('lib/supabase.ts');
  assert.match(login, /Google/);
  assert.match(login, /startGoogleAuth/);
  assert.match(account, /completeAuthFromUrl/);
  assert.match(supabase, /herlink:\/\/auth\/callback/);
  assert.match(login, /signInExistingAccount/);
});

test('web login and callback support Google OAuth without changing account-bind-existing', () => {
  const login = read('apps/web/app/login/page.tsx');
  const callback = read('apps/web/app/auth/callback/page.tsx');
  assert.match(login, /signInWithGoogle/);
  assert.match(login, /signInWithGoogle/);
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(login, /account-bind-existing/);
});

test('Google conflict handling does not merge users or move anonymous data', () => {
  const source = read('lib/account.ts');
  assert.match(source, /identity.*already|already.*identity|conflict/i);
  assert.match(source, /原匿名身分|保留/);
  assert.doesNotMatch(source, /migrat|move.*chat|merge.*user/i);
});

