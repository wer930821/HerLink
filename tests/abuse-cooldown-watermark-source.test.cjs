const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261023173000_fix_repeated_abuse_cooldown.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

// Old events that already caused a completed cooldown must be excluded strictly.
assert.match(sql, /created_at\s*>\s*risk_cutoff/);
assert.doesNotMatch(sql, /created_at\s*>=\s*risk_cutoff/);

// The expired cooldown's original enforcement time remains the watermark.
assert.match(sql, /risk_cutoff\s*:=\s*GREATEST\(risk_cutoff,\s*existing_row\.enforcement_set_at\)/);
assert.match(sql, /WHEN next_decision = 'allow' AND identity_row\.cooldown_until IS NOT NULL THEN identity_row\.enforcement_set_at/);

console.log('PASS abuse cooldown watermark source checks');
