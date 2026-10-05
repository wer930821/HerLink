import fs from "node:fs";

const migrationPath = "supabase/migrations/20261005170000_account_binding_existing_uuid_backend.sql";
const routePath = "apps/web/app/api/account-binding/merge-existing/route.ts";

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

assert(fs.existsSync(migrationPath), "merge migration exists");
assert(fs.existsSync(routePath), "controlled backend route exists");

const sql = fs.readFileSync(migrationPath, "utf8");
const route = fs.readFileSync(routePath, "utf8");

assert(!/require_active_admin\s*\(/i.test(sql), "merge RPC does not require interactive admin session");
assert(/孤星企鵝/.test(sql), "merge is allowlisted to 孤星企鵝");
assert(/p_dry_run/i.test(sql), "dry run remains supported");
assert(/source_display_name/i.test(sql) && /target_display_name/i.test(sql), "audit keeps both names");
assert(/anonymous_display_name\s*=\s*v_source_name/i.test(sql), "target profile keeps source anonymous name");
assert(/revoke\s+all\s+on\s+function[\s\S]+from\s+public/i.test(sql), "PUBLIC execute is revoked");
assert(/grant\s+execute[\s\S]+to\s+service_role/i.test(sql), "only service_role receives RPC execute");
assert(/duplicate_session/i.test(sql) && /duplicate_contact/i.test(sql), "conflicts are blocked before mutation");
assert(/raise exception/i.test(sql), "conflicts abort the transaction for rollback safety");

assert(/SUPABASE_SERVICE_ROLE_KEY/.test(route), "backend uses server-only service role key");
assert(!/NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/.test(route), "service role is never public env");
assert(/admin_merge_anonymous_account/.test(route), "backend calls merge RPC");
assert(/dryRun/.test(route), "backend exposes dry-run mode");
assert(/e2817803-1304-4ef0-b0b8-66f473b12886/.test(route), "route is temporarily allowlisted to 孤星企鵝 UUID");

console.log("existing UUID merge contract: PASS");
