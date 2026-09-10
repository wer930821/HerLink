const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs');

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const readWeb = (relative) => fs.readFileSync(path.join(webRoot, relative), 'utf8').replace(/\r\n/g, '\n');

const homeSource = readWeb('app/page.tsx');
const renameSource = readWeb('lib/anonymous-rename.ts');
const supabaseSource = readWeb('lib/supabase.ts');

const unnamedNameMigration = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/20260909113000_android_unique_anonymous_names.sql'),
  'utf8'
);
const nameLengthMigration = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/20260910090000_android_anonymous_name_length.sql'),
  'utf8'
);
const cooldownMigration = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/20260901191000_web_v01_cooldown_5min.sql'),
  'utf8'
);

const readFunctionBody = (sql, signature) => {
  const start = sql.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist in the migration`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${signature} must have a closing body`);
  return sql.slice(start, end);
};

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://offline.test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'offline-test-anon-key';

const rename = load('apps/web/lib/anonymous-rename.ts', {
  './supabase': { setMyAnonymousDisplayName: async () => ({ data: null, error: null }), rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }) },
});

const cooldownResponse = {
  installation_key: 'anon_browser',
  current_user_id: '00000001-0000-4000-8000-000000000000',
  decision: 'cooldown',
  reason_code: 'anonymous_abuse_cooldown',
  risk_score: 6,
  cooldown_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  temporary_suspension_until: null,
  review_required: false,
};

test('cooldown source: the 5 minute gate comes from register_anonymous_abuse_identity only', () => {
  // The user-facing wording and its 5-minute arithmetic live in the matching gate.
  assert.match(homeSource, /配對操作太頻繁，請約 \$\{minutes\} 分鐘後再試。/);
  assert.match(homeSource, /配對操作太頻繁，請稍後再試。/);
  assert.match(homeSource, /Math\.ceil\(\(Date\.parse\(check\.cooldown_until\) - Date\.now\(\)\) \/ 60000\)/);
  assert.match(homeSource, /const abuseCheck = await registerAnonymousAbuseIdentity\(\)/);

  // The server sets that timestamp to exactly +5 minutes.
  assert.match(cooldownMigration, /next_cooldown_until := timezone\('utc'::text, now\(\)\) \+ INTERVAL '5 minutes'/);
  assert.match(cooldownMigration, /next_reason_code := 'anonymous_abuse_cooldown'/);
});

test('rename flow never calls registerAnonymousAbuseIdentity or the matchmaking precheck', async () => {
  const calls = [];
  const client = {
    setMyAnonymousDisplayName: async (name) => {
      calls.push(`set:${name}`);
      return { data: { status: 'OK', anonymous_display_name: name }, error: null };
    },
    rotateMyAnonymousDisplayName: async () => {
      calls.push('rotate');
      return { data: { status: 'OK', anonymous_display_name: '摸魚企鵝' }, error: null };
    },
  };

  // Even while the installation sits inside an active 5 minute abuse cooldown,
  // the rename path only performs its own two RPCs.
  assert.equal(cooldownResponse.decision, 'cooldown');
  assert.deepEqual(await rename.renameAnonymousDisplayName('月光小鵝', client), { ok: true, name: '月光小鵝' });
  assert.deepEqual(await rename.randomizeAnonymousDisplayName(client), { ok: true, name: '摸魚企鵝' });
  assert.deepEqual(calls, ['set:月光小鵝', 'rotate']);

  // No abuse / matchmaking call exists anywhere on the rename path.
  for (const forbidden of ['register_anonymous_abuse_identity', 'registerAnonymousAbuseIdentity', 'AnonymousAbusePrecheckRow', 'cooldown']) {
    assert.equal(renameSource.includes(forbidden), false, `rename helpers must not reference ${forbidden}`);
  }

  // The web Supabase module legitimately keeps the abuse helper for matchmaking,
  // but neither of the two name helpers may reach it.
  const nameHelperBodies = supabaseSource.slice(
    supabaseSource.indexOf('export async function setMyAnonymousDisplayName'),
    supabaseSource.indexOf('export async function ensureAnonymousBootstrapProfile')
  );
  assert.match(nameHelperBodies, /set_my_anonymous_display_name/);
  assert.match(nameHelperBodies, /rotate_my_anonymous_display_name/);
  for (const forbidden of ['register_anonymous_abuse_identity', 'AnonymousAbusePrecheckRow', 'cooldown']) {
    assert.equal(nameHelperBodies.includes(forbidden), false, `name helpers must not reference ${forbidden}`);
  }

  assert.equal(homeSource.includes('setMessage(`配對操作太頻繁'), true, 'the cooldown message stays a matching-only message');
});

test('the matchmaking abuse gate stays in place and is exercised by both entry points', () => {
  const gates = homeSource.split('await registerAnonymousAbuseIdentity()').length - 1;
  assert.equal(gates, 2, 'anonymous sign-in and random matching each still run the precheck');

  // Matching still refuses to join the queue on cooldown / suspension / blocked.
  assert.match(homeSource, /if \(check\.decision === "cooldown"\)/);
  assert.match(homeSource, /if \(check\.decision === "temporary_suspension"\)/);
  assert.match(homeSource, /此帳號目前無法使用配對功能，請稍後再試。/);
  assert.match(homeSource, /const abuseBlock = await runAbuseCheck\(\);\s*\n\s*if \(abuseBlock\) \{\s*\n\s*showAbuseBlockMessage\(abuseBlock\);\s*\n\s*return;/);
  assert.match(homeSource, /const \{ data, error \} = await findOrJoinRandomMatch\(\);/);
  assert.match(supabaseSource, /supabase\.rpc\("register_anonymous_abuse_identity", \{\s*\n\s*p_installation_id: installationId,/);

  // The rename dialog cannot be used to raise the risk score either: the risk
  // events are written by queue/session/next-match RPCs, not by the name RPCs.
  assert.match(cooldownMigration, /'queue_join'/);
  assert.match(cooldownMigration, /'queue_leave'/);
  assert.match(cooldownMigration, /'next_match'/);
  assert.match(cooldownMigration, /'anonymous_account_rotation'/);
});

test('name RPCs are independent of the anonymous abuse state at the SQL level', () => {
  const setName = readFunctionBody(unnamedNameMigration, 'CREATE OR REPLACE FUNCTION public.set_my_anonymous_display_name(p_name TEXT)');
  const rotateName = readFunctionBody(nameLengthMigration, 'CREATE OR REPLACE FUNCTION public.rotate_my_anonymous_display_name()');

  for (const [label, body] of [['set_my_anonymous_display_name', setName], ['rotate_my_anonymous_display_name', rotateName]]) {
    for (const forbidden of ['anonymous_risk_identities', 'anonymous_risk_events', 'cooldown', 'assert_rate_limit', 'register_anonymous_abuse_identity', 'record_anonymous_risk_event']) {
      assert.equal(body.includes(forbidden), false, `${label} must not touch ${forbidden}`);
    }
    assert.match(body, /auth\.uid\(\)/);
    assert.match(body, /UPDATE public\.profiles/);
  }

  // The rename only ever writes the profile alias and its normalized key.
  assert.match(setName, /SET anonymous_display_name = p_name/);
  assert.match(setName, /EXCEPTION WHEN unique_violation THEN\s*\n\s*RETURN QUERY SELECT 'NAME_TAKEN'::TEXT, NULL::TEXT;/);
});

test('cooldown does not block a legal rename, NAME_TAKEN or the 2-12 character rules', async () => {
  const takenClient = {
    setMyAnonymousDisplayName: async () => ({ data: { status: 'NAME_TAKEN', anonymous_display_name: null }, error: null }),
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  };
  assert.deepEqual(await rename.renameAnonymousDisplayName('阿鵝', takenClient), {
    ok: false,
    code: 'NAME_TAKEN',
    message: '這個匿名名稱已經有人使用了，換一個吧',
  });

  const calls = [];
  const legalClient = {
    setMyAnonymousDisplayName: async (name) => {
      calls.push(name);
      return { data: { status: 'OK', anonymous_display_name: name }, error: null };
    },
    rotateMyAnonymousDisplayName: async () => ({ data: { status: 'OK', anonymous_display_name: '月球住民' }, error: null }),
  };

  assert.deepEqual(await rename.renameAnonymousDisplayName('阿鵝', legalClient), { ok: true, name: '阿鵝' });
  assert.deepEqual(await rename.renameAnonymousDisplayName('abcdefghijkl', legalClient), { ok: true, name: 'abcdefghijkl' });
  assert.deepEqual(await rename.renameAnonymousDisplayName('鵝', legalClient), { ok: false, code: 'TOO_SHORT', message: '名稱至少需要 2 個字' });
  assert.deepEqual(await rename.renameAnonymousDisplayName('abcdefghijklm', legalClient), { ok: false, code: 'TOO_LONG', message: '名稱最多 12 個字' });
  assert.deepEqual(await rename.renameAnonymousDisplayName('  \n  ', legalClient), { ok: false, code: 'INVALID_NAME', message: '名稱格式不正確' });
  assert.deepEqual(await rename.randomizeAnonymousDisplayName(legalClient), { ok: true, name: '月球住民' });
  assert.deepEqual(calls, ['阿鵝', 'abcdefghijkl'], 'rejected drafts never reach the server');
});
