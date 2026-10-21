const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin mailbox can automatically discover prior anonymous identity candidates from recovery/device history', () => {
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8'))
    .join('\n');
  assert.match(migrations, /station_mail_admin_identity_candidates/i);
  assert.match(migrations, /anonymous_identity_device_state/i);
  assert.match(migrations, /anonymous_recovery_attempts/i);

  const page = fs.readFileSync(path.join(__dirname, '..', 'apps', 'web', 'app', 'admin', 'mailbox', 'page.tsx'), 'utf8');
  assert.match(page, /station_mail_admin_identity_candidates/);
  assert.match(page, /可能的舊匿名身分/);
  assert.match(page, /chat_count/);
  assert.match(page, /message_count/);
  assert.match(page, /contact_count/);
});
