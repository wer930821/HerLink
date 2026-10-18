import assert from "node:assert/strict";
import fs from "node:fs";

const proxyPath = new URL("../proxy.ts", import.meta.url);
const configPath = new URL("../lib/site-config.ts", import.meta.url);

// The maintenance gate must exist and be enforced before app code loads.
assert.equal(fs.existsSync(proxyPath), true, "maintenance gate proxy must exist");

const proxySource = fs.readFileSync(proxyPath, "utf8");
// The gate must be controllable via env var (so previews can test the real app
// and production can reopen without a code change).
assert.match(proxySource, /NEXT_PUBLIC_MAINTENANCE_MODE/, "gate must be controlled by env var");
assert.match(proxySource, /NextResponse/);
assert.match(proxySource, /_next\/static/);
assert.doesNotMatch(proxySource, /supabase/i, "maintenance gate must not initialize Supabase");
// The gate must be conditional now, not an unconditional 503:
// traffic must pass through when the switch is off.
assert.match(proxySource, /NextResponse\.next\(\)/, "gate must pass traffic through when maintenance is off");
// The admin backend must stay reachable during maintenance so the site can be
// managed (HerLink 後台 app) while the public site is paused.
assert.match(proxySource, /\/admin/, "gate must exempt the admin backend during maintenance");
assert.match(proxySource, /\/api\/admin\//, "gate must exempt admin API routes during maintenance");

// site-config must derive the flag from the same env var, defaulting to ON
// (paused = safe default; reopening requires a deliberate env change).
const configSource = fs.readFileSync(configPath, "utf8");
assert.match(configSource, /NEXT_PUBLIC_MAINTENANCE_MODE/);
assert.match(configSource, /!==\s*["']false["']/, "maintenance must default to ON when env var is unset");
assert.match(configSource, /HerLink 暫停服務中/);

console.log("maintenance gate contract passed");
