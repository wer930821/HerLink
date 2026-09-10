const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs');

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const readWeb = (relative) => fs.readFileSync(path.join(webRoot, relative), 'utf8').replace(/\r\n/g, '\n');

const supabaseSource = readWeb('lib/supabase.ts');
const renameSource = readWeb('lib/anonymous-rename.ts');

// The web Supabase module builds a real client at import time; a dummy configured
// environment keeps the module offline and lets each test inject its own RPC surface.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://offline.test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'offline-test-anon-key';

// The mocked Supabase surface stays mutable: the rename module captures these two
// functions, so each test refreshes them to reach the RPC mock it installed.
const mockedSupabase = {
  setMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
};

const rename = load('apps/web/lib/anonymous-rename.ts', { './supabase': mockedSupabase });
const supabaseModule = load('apps/web/lib/supabase.ts', {
  '../../../lib/anonymous': { ANONYMOUS_AVATAR_OPTIONS: [{ id: 'avatar_01' }], isAnonymousAvatarId: () => true },
  './anonymous-install': { getAnonymousInstallationId: () => 'anon_test' },
});

function injectRpc(handlers) {
  const calls = [];
  const supabase = supabaseModule.supabase;
  supabase.rpc = async (name, args) => {
    calls.push({ name, args });
    const handler = handlers[name];
    if (typeof handler !== 'function') {
      throw new Error(`unexpected rpc call: ${name}`);
    }
    return await handler(args);
  };
  mockedSupabase.setMyAnonymousDisplayName = supabaseModule.setMyAnonymousDisplayName;
  mockedSupabase.rotateMyAnonymousDisplayName = supabaseModule.rotateMyAnonymousDisplayName;
  return calls;
}

function injectRenameClient(handlers) {
  const calls = [];
  return {
    calls,
    client: {
      setMyAnonymousDisplayName: async (name) => {
        calls.push({ name: 'setMyAnonymousDisplayName', args: name });
        return await handlers.setMyAnonymousDisplayName(name);
      },
      rotateMyAnonymousDisplayName: async () => {
        calls.push({ name: 'rotateMyAnonymousDisplayName' });
        return await handlers.rotateMyAnonymousDisplayName();
      },
    },
  };
}

test('web supabase helpers call set_my_anonymous_display_name and rotate_my_anonymous_display_name', async () => {
  const calls = injectRpc({
    set_my_anonymous_display_name: async () => ({ data: [{ status: 'OK', anonymous_display_name: '月光小鵝' }], error: null }),
    rotate_my_anonymous_display_name: async () => ({ data: [{ status: 'OK', anonymous_display_name: '摸魚企鵝' }], error: null }),
  });

  const renamed = await supabaseModule.setMyAnonymousDisplayName('月光小鵝');
  const rotated = await supabaseModule.rotateMyAnonymousDisplayName();

  assert.deepEqual(renamed, { data: { status: 'OK', anonymous_display_name: '月光小鵝' }, error: null });
  assert.deepEqual(rotated, { data: { status: 'OK', anonymous_display_name: '摸魚企鵝' }, error: null });
  assert.deepEqual(calls.map((call) => call.name), ['set_my_anonymous_display_name', 'rotate_my_anonymous_display_name']);
  assert.deepEqual(calls[0].args, { p_name: '月光小鵝' }, 'custom rename sends only p_name');
  assert.equal(calls[1].args, undefined, 'random rotate takes no arguments');
});

test('web supabase helpers normalize the shared (status, anonymous_display_name) RPC shape', async () => {
  injectRpc({
    set_my_anonymous_display_name: async () => ({ data: { status: 'OK', anonymous_display_name: '  月亮 小鵝  ' }, error: null }),
    rotate_my_anonymous_display_name: async () => ({ data: [{ status: 'NAME_TAKEN', anonymous_display_name: null }], error: null }),
  });

  // A single object, an array, and blank names all collapse to one row shape.
  assert.deepEqual(await supabaseModule.setMyAnonymousDisplayName('  月亮 小鵝  '), {
    data: { status: 'OK', anonymous_display_name: '月亮 小鵝' },
    error: null,
  });
  assert.deepEqual(await supabaseModule.rotateMyAnonymousDisplayName(), {
    data: { status: 'NAME_TAKEN', anonymous_display_name: null },
    error: null,
  });
});

test('web custom rename uses the set_my_anonymous_display_name RPC and shows the server name', async () => {
  const { calls, client } = injectRenameClient({
    setMyAnonymousDisplayName: async () => ({ data: { status: 'OK', anonymous_display_name: '月光小鵝' }, error: null }),
    rotateMyAnonymousDisplayName: async () => { throw new Error('random must not run for a custom rename'); },
  });

  const result = await rename.renameAnonymousDisplayName('月光小鵝', client);

  assert.deepEqual(result, { ok: true, name: '月光小鵝' });
  assert.deepEqual(calls, [{ name: 'setMyAnonymousDisplayName', args: '月光小鵝' }]);
  assert.match(renameSource, /setMyAnonymousDisplayName\(rawName\)/);
});

test('web custom rename displays the normalized server name, never the raw draft', async () => {
  const { client } = injectRenameClient({
    setMyAnonymousDisplayName: async (name) => {
      assert.equal(name, '  月亮   小鵝  ', 'the draft is handed to the server for normalization');
      return { data: { status: 'OK', anonymous_display_name: '月亮 小鵝' }, error: null };
    },
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  });

  assert.deepEqual(await rename.renameAnonymousDisplayName('  月亮   小鵝  ', client), { ok: true, name: '月亮 小鵝' });
});

test('web custom rename works through the default supabase helper without an injected client', async () => {
  const calls = injectRpc({
    set_my_anonymous_display_name: async (args) => ({ data: [{ status: 'OK', anonymous_display_name: String(args.p_name).trim() }], error: null }),
  });

  // No injected client: this is the same path the Web dialog takes.
  const result = await rename.renameAnonymousDisplayName('月光小鵝');

  assert.deepEqual(result, { ok: true, name: '月光小鵝' });
  assert.deepEqual(calls, [{ name: 'set_my_anonymous_display_name', args: { p_name: '月光小鵝' } }]);
});

test('web rename maps NAME_TAKEN to the friendly duplicate message', async () => {
  const byStatus = injectRenameClient({
    setMyAnonymousDisplayName: async () => ({ data: { status: 'NAME_TAKEN', anonymous_display_name: null }, error: null }),
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  });
  assert.deepEqual(await rename.renameAnonymousDisplayName('阿鵝', byStatus.client), {
    ok: false,
    code: 'NAME_TAKEN',
    message: '這個匿名名稱已經有人使用了，換一個吧',
  });

  const byError = injectRenameClient({
    setMyAnonymousDisplayName: async () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "profiles_anonymous_display_name_normalized_unique"' },
    }),
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  });
  assert.deepEqual(await rename.renameAnonymousDisplayName('阿鵝', byError.client), {
    ok: false,
    code: 'NAME_TAKEN',
    message: '這個匿名名稱已經有人使用了，換一個吧',
  });
});

test('web rename maps server validation failures without leaking database errors', async () => {
  const cases = [
    ['TOO_SHORT', '名稱至少需要 2 個字'],
    ['TOO_LONG', '名稱最多 12 個字'],
    ['INVALID_NAME', '名稱格式不正確'],
  ];

  for (const [code, message] of cases) {
    const { client } = injectRenameClient({
      setMyAnonymousDisplayName: async () => ({ data: null, error: { code: 'P0001', message: code } }),
      rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
    });
    assert.deepEqual(await rename.renameAnonymousDisplayName('阿鵝', client), { ok: false, code, message });
  }

  const leaked = injectRenameClient({
    setMyAnonymousDisplayName: async () => ({ data: null, error: { code: '08006', message: 'PostgreSQL error: connection failure' } }),
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  });
  const result = await rename.renameAnonymousDisplayName('阿鵝', leaked.client);
  assert.deepEqual(result, { ok: false, code: 'NETWORK_ERROR', message: '網路連線失敗，請稍後再試' });
  for (const token of ['23505', 'duplicate key', 'PostgreSQL', 'P0001']) {
    assert.equal(result.message.includes(token), false, `leaked ${token}`);
  }

  const thrown = injectRenameClient({
    setMyAnonymousDisplayName: async () => { throw new Error('Failed to fetch'); },
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  });
  assert.deepEqual(await rename.renameAnonymousDisplayName('阿鵝', thrown.client), {
    ok: false,
    code: 'NETWORK_ERROR',
    message: '網路連線失敗，請稍後再試',
  });
});

test('web rename rejects a 13 character name before any network call', async () => {
  const { calls, client } = injectRenameClient({
    setMyAnonymousDisplayName: async () => { throw new Error('invalid drafts must not reach the server'); },
    rotateMyAnonymousDisplayName: async () => { throw new Error('invalid drafts must not reach the server'); },
  });

  const result = await rename.renameAnonymousDisplayName('abcdefghijklm', client);

  assert.deepEqual(result, { ok: false, code: 'TOO_LONG', message: '名稱最多 12 個字' });
  assert.equal(calls.length, 0, 'invalid drafts must not reach the server');

  assert.equal(rename.validateAnonymousDisplayNameDraft('abcdefghijkl'), null);
  assert.equal(rename.validateAnonymousDisplayNameDraft('鵝'), 'TOO_SHORT');
  assert.equal(rename.validateAnonymousDisplayNameDraft('  \n  '), 'INVALID_NAME');
  assert.equal(rename.validateAnonymousDisplayNameDraft('阿鵝'), null);
});

test('web random rename uses rotate_my_anonymous_display_name with no arguments', async () => {
  const calls = injectRpc({
    rotate_my_anonymous_display_name: async () => ({ data: [{ status: 'OK', anonymous_display_name: '摸魚企鵝' }], error: null }),
  });

  // No injected client: this is the same path the Web dialog takes.
  const result = await rename.randomizeAnonymousDisplayName();

  assert.deepEqual(result, { ok: true, name: '摸魚企鵝' });
  assert.deepEqual(calls, [{ name: 'rotate_my_anonymous_display_name', args: undefined }]);
});

test('web random rename never keeps a client side name pool', async () => {
  const calls = injectRpc({
    rotate_my_anonymous_display_name: async () => ({ data: [{ status: 'OK', anonymous_display_name: '月球住民' }], error: null }),
  });

  const first = await rename.randomizeAnonymousDisplayName();
  const second = await rename.randomizeAnonymousDisplayName();

  assert.deepEqual([first, second], [{ ok: true, name: '月球住民' }, { ok: true, name: '月球住民' }]);
  assert.deepEqual(calls.map((call) => call.name), ['rotate_my_anonymous_display_name', 'rotate_my_anonymous_display_name']);
  assert.equal(calls.some((call) => call.name === 'set_my_anonymous_display_name'), false);

  for (const banned of ['星河XX', 'fallbackOldNames', 'ADJECTIVES', 'NOUNS', 'randomNamePool']) {
    assert.equal(renameSource.includes(banned), false, `client random generator residue: ${banned}`);
  }
});

test('web rename reaches the database only through the two RPC helpers, never through profile writes', () => {
  assert.equal(/\.from\(\s*["']profiles["']\s*\)/.test(renameSource), false, 'rename must not touch profiles directly');
  assert.equal(/\.update\(/.test(renameSource), false);
  assert.equal(/\.upsert\(/.test(renameSource), false);
  assert.match(renameSource, /import \{ rotateMyAnonymousDisplayName, setMyAnonymousDisplayName \} from "\.\/supabase"/);
  assert.match(supabaseSource, /supabase\.rpc\("set_my_anonymous_display_name", \{ p_name: name \}\)/);
  assert.match(supabaseSource, /supabase\.rpc\("rotate_my_anonymous_display_name"\)/);
});

test('web home page opens the rename dialog, calls the RPC and refreshes the shown name', () => {
  const homeSource = readWeb('app/page.tsx');

  assert.match(homeSource, /更換匿名暱稱/);
  assert.match(homeSource, /<Modal open=\{renameOpen\} title="匿名暱稱"/);
  assert.match(homeSource, /2–12 個字，名稱不可重複/);
  assert.match(homeSource, /使用這個名稱/);
  assert.match(homeSource, /隨機一個/);
  assert.match(homeSource, /await renameAnonymousDisplayName\(renameDraft\)/);
  assert.match(homeSource, /await randomizeAnonymousDisplayName\(\)/);

  // The displayed state is replaced by the server name, so no F5 is required.
  assert.match(homeSource, /anonymous_display_name: name/);
  assert.match(homeSource, /<strong>\{anonymousSummary\?\.name \?\? "匿名使用者"\}<\/strong>/);

  // Real-name / dating-profile fields stay out of the anonymous rename flow.
  for (const banned of ['真實姓名', '年齡', '地區', '性向', '自介']) {
    assert.equal(homeSource.slice(homeSource.indexOf('<Modal open={renameOpen}')).includes(banned), false, `rename dialog gained ${banned}`);
  }
});

test('reload and re-login read the persisted name from the server row', async () => {
  const persisted = { id: 'self', anonymous_mode_enabled: true, anonymous_display_name: '月光小鵝', anonymous_avatar: 'avatar_01', account_status: 'active' };
  let rotated = false;

  // A real page load only reads the stored row again; it never rotates a saved name.
  supabaseModule.supabase.from = () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: persisted, error: null }),
  });
  supabaseModule.supabase.rpc = async (name) => {
    rotated = true;
    throw new Error(`bootstrap must not rotate an existing name: ${name}`);
  };

  assert.equal(supabaseModule.isSupabaseConfigured(), true, 'the offline client must be exercisable');
  const loaded = await supabaseModule.ensureAnonymousBootstrapProfile('self');

  assert.equal(loaded.data.anonymous_display_name, '月光小鵝');
  assert.equal(rotated, false, 'a stored name survives reload and re-login');
});

test('rename never widens the anonymous profile projection', async () => {
  const { client } = injectRenameClient({
    setMyAnonymousDisplayName: async () => ({
      data: {
        status: 'OK',
        anonymous_display_name: '月光小鵝',
        id: '2d0f7c1e-0000-4000-8000-000000000000',
        display_name: 'Private Real Name',
        email: 'private@example.com',
        city: 'Taipei',
        bio: 'private bio',
      },
      error: null,
    }),
    rotateMyAnonymousDisplayName: async () => ({ data: null, error: null }),
  });

  const result = await rename.renameAnonymousDisplayName('月光小鵝', client);

  assert.deepEqual(Object.keys(result).sort(), ['name', 'ok']);
  assert.equal(result.name, '月光小鵝');
  const exposed = JSON.stringify(result);
  for (const token of ['2d0f7c1e', 'private@example.com', 'Private Real Name', 'Taipei', 'private bio']) {
    assert.equal(exposed.includes(token), false, `rename result leaked ${token}`);
  }
});

test('web rename module contains no UUID or email handling', () => {
  for (const banned of ['email', 'auth.users', 'profiles!inner']) {
    assert.equal(renameSource.toLowerCase().includes(banned.toLowerCase()), false, `rename module references ${banned}`);
  }
});
