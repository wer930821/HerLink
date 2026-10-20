import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairContextQuery, validateRepairContextFiles } from '../lib/station-operator/repair-context.mjs';

test('builds a small code-search query from a sanitized repair summary', () => {
  const query = buildRepairContextQuery({
    summary: '聊天室的「回覆訊息」按鈕點下去沒有反應',
    area: 'chat',
    feature: 'reply',
    symptom: 'click_no_effect',
  });

  assert.equal(query.ok, true);
  assert.match(query.query, /chat/i);
  assert.match(query.query, /reply/i);
  assert.doesNotMatch(query.query, /thread|message[_ -]?id|bearer|api[_ -]?key/i);
  assert.ok(query.query.length <= 240);
});

test('context discovery accepts only a small unique set of approved app files', () => {
  const result = validateRepairContextFiles([
    'apps/web/app/session/[id]/page.tsx',
    'apps/web/app/session/[id]/RandomSessionClient.tsx',
    'apps/web/__tests__/station-repair-context.test.mjs',
  ]);

  assert.deepEqual(result, {
    ok: true,
    files: [
      'apps/web/app/session/[id]/page.tsx',
      'apps/web/app/session/[id]/RandomSessionClient.tsx',
      'apps/web/__tests__/station-repair-context.test.mjs',
    ],
  });
});

test('context discovery fails closed for unsafe, duplicate, or excessive files', () => {
  assert.equal(validateRepairContextFiles(['.github/workflows/x.yml']).ok, false);
  assert.equal(validateRepairContextFiles(['supabase/migrations/x.sql']).ok, false);
  assert.equal(validateRepairContextFiles(['apps/web/lib/station-operator/worker.mjs']).ok, false);
  assert.equal(validateRepairContextFiles(['apps/web/app/a.tsx', 'apps/web/app/a.tsx']).ok, false);
  assert.equal(validateRepairContextFiles([
    'apps/web/app/a.tsx',
    'apps/web/app/b.tsx',
    'apps/web/app/c.tsx',
    'apps/web/app/d.tsx',
    'apps/web/app/e.tsx',
    'apps/web/app/f.tsx',
  ]).ok, false);
});

test('context query rejects raw mailbox identifiers and secret-like content', () => {
  assert.equal(buildRepairContextQuery({ summary: 'thread_id=abc reply button broken', area: 'chat' }).ok, false);
  assert.equal(buildRepairContextQuery({ summary: 'api_key=sk-secret reply button broken', area: 'chat' }).ok, false);
});
