const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261023173000_fix_repeated_abuse_cooldown.sql'),
  'utf8'
);

assert.match(sql, /risk_cutoff := GREATEST\(risk_cutoff, existing_row\.enforcement_set_at\)/);
assert.match(sql, /timezone\('utc'::text, now\(\)\) >= existing_row\.cooldown_until/);
assert.match(sql, /timezone\('utc'::text, now\(\)\) >= existing_row\.temporary_suspension_until/);
assert.match(sql, /created_at > risk_cutoff/g);
assert.match(sql, /WHEN next_decision = 'cooldown' AND next_cooldown_until = identity_row\.cooldown_until THEN identity_row\.enforcement_set_at/);
assert.match(sql, /WHEN next_decision = 'temporary_suspension' AND next_temporary_until = identity_row\.temporary_suspension_until THEN identity_row\.enforcement_set_at/);
assert.match(sql, /WHEN next_decision IN \('cooldown', 'temporary_suspension'\) THEN timezone\('utc'::text, now\(\)\)/);
assert.match(sql, /WHEN next_decision = 'allow' AND \(identity_row\.cooldown_until IS NOT NULL OR identity_row\.temporary_suspension_until IS NOT NULL\) THEN identity_row\.enforcement_set_at/);
assert.match(sql, /INTERVAL '5 minutes'/);
assert.match(sql, /INTERVAL '24 hours'/);
assert.match(sql, /COMMIT;/);

console.log('PASS cooldown watermark clean regression contract');
