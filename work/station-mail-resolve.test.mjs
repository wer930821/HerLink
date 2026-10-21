import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('apps/web/app/admin/mailbox/page.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261021133000_station_mail_admin_resolve.sql', 'utf8');

test('admin mailbox can resolve a thread without replying', () => {
  assert.match(page, /station_mail_admin_resolve/);
  assert.match(page, /標記完成/);
  assert.match(page, /已處理/);
  assert.match(migration, /create or replace function public\.station_mail_admin_resolve/);
  assert.match(migration, /status\s*=\s*'resolved'/);
  assert.match(migration, /grant execute on function public\.station_mail_admin_resolve\(uuid\) to authenticated/);
});
