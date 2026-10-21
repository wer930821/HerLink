import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/admin/mailbox/page.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../../supabase/migrations/20261021233000_admin_manual_identity_claim.sql', import.meta.url), 'utf8');

test('人工接回可用匿名名稱搜尋 identity，不要求管理員輸入 UUID', () => {
  assert.match(page, /station_mail_admin_identity_search/);
  assert.match(page, /匿名名稱搜尋/);
  assert.match(migration, /station_mail_admin_identity_search/);
});
