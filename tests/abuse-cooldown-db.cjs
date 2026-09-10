// Focused PostgreSQL tests for anonymous abuse cooldown retention semantics.
//
// The abuse status functions are loaded exactly as applied in production (the
// full migration chain, in order), then the fix migration is applied on top so
// the checks below prove the deadline no longer slides on retry.
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = (file) => path.join(root, 'supabase/migrations', file);
const uid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
// `register_anonymous_abuse_identity` hashes the client installation id with
// `anonymous_installation_key(id) = md5(lower(btrim(id)))` and stores risk data
// under that hash. `raw()` is what the browser sends; `key()` is the stored row.
const raw = (suffix) => `anon-cooldown-${suffix}`;
const key = (suffix) => createHash('md5').update(raw(suffix)).digest('hex');

const abuseFixes = [
  '20260830123000_web_v01_anonymous_abuse_prevention_fix.sql',
  '20260830124000_web_v01_anonymous_abuse_prevention_fix2.sql',
  '20260901183000_web_v01_matchmaking_incident_fix.sql',
  '20260901184000_web_v01_matchmaking_incident_fix2.sql',
  '20260901191000_web_v01_cooldown_5min.sql',
];
const fixMigration = '20260910120000_fix_sliding_abuse_cooldown.sql';

(async () => {
  const db = new PGlite();
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const actor = async (n) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uid(n)}',false); SET ROLE authenticated;`);

  // Mirrors what the Web client does: one RPC call as the signed-in anon user.
  // The reader helpers below drop the role, so each call re-issues the actor.
  // `SKIP_COOLDOWN_FIX=1` loads the pre-fix chain to demonstrate the old sliding
  // behavior fails these same checks.
  const abusePrecheck = async (actorNumber, installationKey) => {
    await actor(actorNumber);
    return (await rows('SELECT * FROM register_anonymous_abuse_identity($1)', [installationKey]))[0];
  };

  const insertRiskEvents = async (installationKey, userId, eventType, count, ageInterval) => {
    for (let index = 0; index < count; index += 1) {
      await db.exec(`RESET ROLE;
        INSERT INTO anonymous_risk_events (installation_key, user_id, event_type, created_at)
        VALUES ('${installationKey}', '${userId}', '${eventType}', timezone('utc'::text, now()) - INTERVAL '${ageInterval}');`);
    }
  };

  // Drives the identity into an active cooldown: 6 joins score GREATEST(6-3,0)=3
  // and the registration adds one recent `anonymous_signup` rotation, so the
  // cooldown branch fires while every escalation threshold stays untouched. The
  // resulting score is what the retry checks assert stays frozen.
  const COOLDOWN_SCORE_EVENTS = 3;
  const seedCooldownScore = async (installationKey, userId, ageInterval = '5 minutes') => {
    await insertRiskEvents(installationKey, userId, 'queue_join', 6, ageInterval);
    await insertRiskEvents(installationKey, userId, 'next_match', 2, ageInterval);
    await insertRiskEvents(installationKey, userId, 'queue_leave', 1, ageInterval);
  };

  const seedCooldownIdentity = async (installationKey, userId) => {
    await resetIdentity(installationKey, userId);
    await seedCooldownScore(installationKey, userId);
  };

  const storedCooldown = async (installationKey) => {
    await db.exec('RESET ROLE;');
    return (await rows('SELECT cooldown_until, enforcement_set_at, temporary_suspension_until, last_risk_score, last_decision FROM anonymous_risk_identities WHERE installation_key = $1', [installationKey]))[0];
  };

  const eventCount = async (installationKey) => {
    await db.exec('RESET ROLE;');
    return (await rows('SELECT COUNT(*)::INT AS n FROM anonymous_risk_events WHERE installation_key = $1', [installationKey]))[0].n;
  };

  // Timestamps come back as Date-like values; compare instants through `new Date`
  // and measure remaining time against the database clock so the assertions stay
  // timezone independent.
  const epoch = (value) => new Date(value).getTime();
  const dbNow = async () => {
    await db.exec('RESET ROLE;');
    return epoch((await rows("SELECT timezone('utc'::text, now()) AS now_utc"))[0].now_utc);
  };
  const remainingMinutes = async (value) => (epoch(value) - await dbNow()) / 60000;
  const remainingHours = async (value) => (epoch(value) - await dbNow()) / 3600000;

  const resetIdentity = async (installationKey, userId, options = {}) => {
    await db.exec(`RESET ROLE;
      DELETE FROM anonymous_risk_events WHERE installation_key = '${installationKey}';
      DELETE FROM anonymous_risk_identities WHERE installation_key = '${installationKey}';
      INSERT INTO anonymous_risk_identities (installation_key, first_user_id, current_user_id, first_seen_at, last_seen_at, last_account_rotation_at)
      VALUES ('${installationKey}', '${userId}', '${userId}',
        timezone('utc'::text, now()) - INTERVAL '2 days',
        timezone('utc'::text, now()),
        timezone('utc'::text, now()) - INTERVAL '2 days');`);
    if (options.events) {
      await insertRiskEvents(installationKey, userId, options.events.type, options.events.count, options.events.age);
    }
  };

  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'security-fixture.sql'), 'utf8'));

    // Production objects the abuse functions expect, kept minimal.
    await db.exec(`
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
      CREATE TABLE public.reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE public.moderation_enforcements (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        subject_user_id UUID,
        enforcement_type TEXT,
        status TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE public.moderation_logs (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        target_user_id UUID,
        action TEXT,
        reason TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE FUNCTION public.internal_write_moderation_log(UUID, UUID, UUID, TEXT, TEXT, JSONB) RETURNS VOID LANGUAGE sql AS $$ SELECT $$;
      CREATE TABLE public.random_action_rate_limit_events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id UUID,
        action_key TEXT,
        context JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE FUNCTION public.check_random_action_rate_limit(TEXT, INTEGER, INTERVAL, JSONB) RETURNS VOID LANGUAGE sql AS $$ SELECT $$;
      CREATE TABLE public.fraud_risk_events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id UUID,
        session_id UUID,
        message_id UUID,
        risk_level TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      -- The fixture stubs a few helpers with narrower signatures than the real
      -- migrations use; drop them so the chain installs the production versions.
      DROP FUNCTION IF EXISTS public.record_anonymous_risk_event_by_user_id(UUID, TEXT, JSONB);
      DROP FUNCTION IF EXISTS public.reconcile_anonymous_matchmaking_identity(UUID);
      DROP FUNCTION IF EXISTS public.is_anonymous_matchmaking_allowed(UUID);
      DROP FUNCTION IF EXISTS public.join_random_match_internal(UUID, UUID);`);

    for (const file of ['20260830120000_web_v01_anonymous_abuse_prevention.sql', ...abuseFixes]) {
      await db.exec(fs.readFileSync(migration(file), 'utf8'));
    }
    if (!process.env.SKIP_COOLDOWN_FIX) {
      await db.exec(fs.readFileSync(migration(fixMigration), 'utf8'));
    }

    await db.exec(`INSERT INTO auth.users SELECT ('0000000' || n || '-0000-4000-8000-000000000000')::uuid FROM generate_series(1,9) n;
      INSERT INTO profiles(id, display_name, account_status, anonymous_mode_enabled, onboarding_completed, anonymous_display_name, anonymous_avatar)
      SELECT id, 'REAL NAME', 'active', true, true, 'N' || substring(id::text FROM 1 FOR 8), 'avatar_01' FROM auth.users;`);

    // ---- Cooldown semantics -------------------------------------------------

    let cooldownUntil = null;

    await check('Test 1: reaching the threshold opens a 5 minute cooldown window', async () => {
      await seedCooldownIdentity(key('t1'), uid(1));

      const first = await abusePrecheck(1, raw('t1'));
      assert.equal(first.decision, 'cooldown');
      assert.equal(first.reason_code, 'anonymous_abuse_cooldown');
      assert.ok(first.cooldown_until, 'a cooldown deadline must be returned');

      const remaining = await remainingMinutes(first.cooldown_until);
      assert.ok(remaining > 4.5 && remaining <= 5, `expected about 5 minutes, got ${remaining}`);

      const stored = await storedCooldown(key('t1'));
      assert.equal(epoch(stored.cooldown_until), epoch(first.cooldown_until));
      cooldownUntil = epoch(first.cooldown_until);
    });

    await check('Test 2: a retry right after the cooldown keeps the original expiry', async () => {
      await actor(1);
      const retry = await abusePrecheck(1, raw('t1'));

      assert.equal(retry.decision, 'cooldown');
      assert.equal(retry.reason_code, 'cooldown_active');
      assert.equal(epoch(retry.cooldown_until), cooldownUntil, 'retrying must not create a new 5 minute window');

      const stored = await storedCooldown(key('t1'));
      assert.equal(epoch(stored.cooldown_until), cooldownUntil);
      assert.equal(stored.last_decision, 'cooldown');
    });

    await check('Test 3: repeated retries never move the expiry forward', async () => {
      await actor(1);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const retry = await abusePrecheck(1, raw('t1'));
        assert.equal(retry.decision, 'cooldown');
        assert.equal(epoch(retry.cooldown_until), cooldownUntil, `attempt ${attempt + 1} moved the deadline`);
      }

      const stored = await storedCooldown(key('t1'));
      assert.equal(epoch(stored.cooldown_until), cooldownUntil);
      assert.equal(epoch(stored.enforcement_set_at) <= await dbNow(), true, 'the original enforcement stamp must survive');
    });

    await check('the deadline stays fixed even when the rotation cutoff moves forward', async () => {
      // This is the shape that used to slide: the enforcement stamp no longer
      // satisfies `enforcement_set_at >= rotation_cutoff`, so the threshold branch
      // below used to run again and rewrite the deadline.
      const installationKey = key('tcutoff');
      await seedCooldownIdentity(installationKey, uid(1));
      const opened = await abusePrecheck(1, raw('tcutoff'));
      assert.equal(opened.decision, 'cooldown');
      const openedUntil = epoch(opened.cooldown_until);

      // A fresh anonymous account on the same installation moves the cutoff to now.
      await db.exec(`RESET ROLE;
        UPDATE anonymous_risk_identities
        SET last_account_rotation_at = timezone('utc'::text, now())
        WHERE installation_key = '${installationKey}';`);

      const retry = await abusePrecheck(1, raw('tcutoff'));
      assert.equal(retry.decision, 'cooldown');
      assert.equal(epoch(retry.cooldown_until), openedUntil, 'a moved rotation cutoff must not restart the window');
    });

    await check('Test 5: retrying during cooldown adds no risk score and no risk events', async () => {
      const installationKey = key('t5');
      await seedCooldownIdentity(installationKey, uid(1));
      await abusePrecheck(1, raw('t5'));

      const before = await storedCooldown(installationKey);
      const eventsBefore = await eventCount(installationKey);
      assert.equal(Number(before.last_risk_score), COOLDOWN_SCORE_EVENTS, 'the seeded risk score must be the one under test');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await abusePrecheck(1, raw('t5'));
      }

      const after = await storedCooldown(installationKey);
      const eventsAfter = await eventCount(installationKey);

      assert.equal(after.last_risk_score, before.last_risk_score, 'a blocked retry must not raise the score');
      assert.equal(Number(after.last_risk_score), COOLDOWN_SCORE_EVENTS, 'the score must stay at the seeded value');
      assert.equal(eventsAfter, eventsBefore, 'a blocked retry must not record queue_join or rotation events');
      assert.equal(epoch(after.cooldown_until), epoch(before.cooldown_until), 'the deadline must not move while retrying');
    });

    await check('Test 4: after expiry the identity is re-evaluated from the current risk state', async () => {
      const beforeExpiry = await storedCooldown(key('t1'));
      const previousUntil = epoch(beforeExpiry.cooldown_until);
      const previousEnforcement = epoch(beforeExpiry.enforcement_set_at);

      await db.exec(`RESET ROLE;
        UPDATE anonymous_risk_identities
        SET cooldown_until = timezone('utc'::text, now())
        WHERE installation_key = '${key('t1')}';`);

      const expired = await abusePrecheck(1, raw('t1'));
      const stored = await storedCooldown(key('t1'));

      // The risk state is unchanged and still inside the 15 minute window, so the
      // expiry releases the old window and opens a genuinely new one.
      assert.equal(expired.decision, 'cooldown');
      assert.equal(expired.reason_code, 'anonymous_abuse_cooldown', 'a new window is not the preserved one');
      const newUntil = epoch(stored.cooldown_until);
      assert.ok(newUntil > previousUntil, 'the expired deadline must be replaced');
      assert.ok(epoch(stored.enforcement_set_at) > previousEnforcement, 'a new window gets a new enforcement stamp');
      const newWindowMinutes = await remainingMinutes(stored.cooldown_until);
      assert.ok(newWindowMinutes > 4.5 && newWindowMinutes <= 5.1, `a genuinely new window is still 5 minutes, got ${newWindowMinutes}`);
    });

    await check('Test 4b: after expiry a settled identity is released', async () => {
      await seedCooldownIdentity(key('t4b'), uid(2));
      await actor(2);
      await abusePrecheck(2, raw('t4b'));

      await db.exec(`RESET ROLE;
        UPDATE anonymous_risk_identities
        SET cooldown_until = timezone('utc'::text, now()) - INTERVAL '1 second'
        WHERE installation_key = '${key('t4b')}';
        UPDATE anonymous_risk_events
        SET created_at = timezone('utc'::text, now()) - INTERVAL '20 minutes'
        WHERE installation_key = '${key('t4b')}';`);
      await actor(2);

      const released = await abusePrecheck(2, raw('t4b'));
      assert.equal(released.decision, 'allow');
      assert.equal(released.reason_code, null);
      assert.equal(released.cooldown_until, null);
      const stored = await storedCooldown(key('t4b'));
      assert.equal(stored.cooldown_until, null);
      assert.equal(stored.enforcement_set_at, null);
    });

    // ---- Temporary suspension ----------------------------------------------

    await check('Test 6: an active temporary suspension keeps its original 24 hour expiry', async () => {
      await resetIdentity(key('t6'), uid(3), { events: { type: 'report_received', count: 5, age: '1 hour' } });
      await actor(3);

      const first = await abusePrecheck(3, raw('t6'));
      assert.equal(first.decision, 'temporary_suspension');
      assert.equal(first.reason_code, 'anonymous_abuse_high_risk');
      assert.ok(first.temporary_suspension_until);

      const expiry = epoch(first.temporary_suspension_until);
      const remaining = await remainingHours(first.temporary_suspension_until);
      assert.ok(remaining > 23.5 && remaining <= 24, `expected about 24 hours, got ${remaining}`);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const retry = await abusePrecheck(3, raw('t6'));
        assert.equal(retry.decision, 'temporary_suspension');
        assert.equal(retry.reason_code, 'temporary_suspension_active');
        assert.equal(epoch(retry.temporary_suspension_until), expiry, `retry ${attempt + 1} renewed the suspension`);
      }

      const stored = await storedCooldown(key('t6'));
      assert.equal(epoch(stored.temporary_suspension_until), expiry);
    });

    await check('Test 6b: suspension keeps its expiry while a blocked account is reported', async () => {
      await db.exec(`RESET ROLE; UPDATE profiles SET account_status = 'suspended' WHERE id = '${uid(3)}';`);
      await actor(3);

      const blocked = await abusePrecheck(3, raw('t6'));
      assert.equal(blocked.decision, 'blocked');
      assert.equal(blocked.reason_code, 'account_restricted');
      assert.equal(epoch(blocked.temporary_suspension_until) > await dbNow(), true);

      await db.exec(`RESET ROLE; UPDATE profiles SET account_status = 'active' WHERE id = '${uid(3)}';`);
    });

    // ---- Abuse protection still triggers -----------------------------------

    await check('Test 7: account rotation still trips both thresholds', async () => {
      const installationKey = key('t7');
      await resetIdentity(installationKey, uid(4));
      await actor(4);

      // Two rotations on the same installation: rotation_count >= 2 -> cooldown.
      await db.exec(`RESET ROLE;
        INSERT INTO anonymous_risk_events (installation_key, user_id, event_type, created_at)
        VALUES ('${installationKey}', '${uid(4)}', 'anonymous_account_rotation', timezone('utc'::text, now()) - INTERVAL '10 minutes'),
               ('${installationKey}', '${uid(4)}', 'anonymous_account_rotation', timezone('utc'::text, now()) - INTERVAL '5 minutes');`);
      await actor(4);

      const twoRotations = await abusePrecheck(4, raw('t7'));
      assert.equal(twoRotations.decision, 'cooldown');
      assert.equal(twoRotations.reason_code, 'anonymous_abuse_cooldown');

      // A third rotation escalates to the 24 hour suspension once the cooldown
      // window itself is cleared (a genuinely new evaluation, not a retry).
      await db.exec(`RESET ROLE;
        UPDATE anonymous_risk_identities
        SET cooldown_until = NULL, temporary_suspension_until = NULL, enforcement_set_at = NULL
        WHERE installation_key = '${installationKey}';
        INSERT INTO anonymous_risk_events (installation_key, user_id, event_type, created_at)
        VALUES ('${installationKey}', '${uid(4)}', 'anonymous_account_rotation', timezone('utc'::text, now()) - INTERVAL '1 minute');`);
      await actor(4);

      const threeRotations = await abusePrecheck(4, raw('t7'));
      assert.equal(threeRotations.decision, 'temporary_suspension');
      assert.equal(threeRotations.reason_code, 'anonymous_abuse_high_risk');
    });

    await check('Test 7b: queue joins and next matches still trip the cooldown threshold', async () => {
      await resetIdentity(key('t7b'), uid(5), { events: { type: 'queue_join', count: 6, age: '5 minutes' } });
      await actor(5);
      await insertRiskEvents(key('t7b'), uid(5), 'next_match', 2, '5 minutes');

      const decision = await abusePrecheck(5, raw('t7b'));
      assert.equal(decision.decision, 'cooldown');
      assert.equal(decision.reason_code, 'anonymous_abuse_cooldown');
    });

    await check('Test 7c: reports and blocks still escalate without cooldown leniency', async () => {
      await resetIdentity(key('t7c'), uid(6));
      await actor(6);
      await insertRiskEvents(key('t7c'), uid(6), 'block_received', 3, '2 hours');

      const decision = await abusePrecheck(6, raw('t7c'));
      assert.equal(decision.decision, 'temporary_suspension');
      assert.equal(decision.reason_code, 'anonymous_abuse_high_risk');
    });

    await check('Test 7d: registration clears a cooldown inherited from another account', async () => {
      const installationKey = key('t7d');
      await seedCooldownIdentity(installationKey, uid(7));
      assert.equal((await abusePrecheck(7, raw('t7d'))).decision, 'cooldown');

      // A new anonymous account on the same installation inherits a fresh state:
      // the rotation cutoff moves forward, so the old window must not follow it.
      const rotated = await abusePrecheck(8, raw('t7d'));
      assert.equal(rotated.current_user_id, uid(8));
      assert.equal(rotated.decision, 'allow');
      assert.equal(rotated.cooldown_until, null, 'the previous account cooldown must be released');
      const stored = await storedCooldown(installationKey);
      assert.equal(stored.cooldown_until, null);
      assert.equal(stored.enforcement_set_at, null);
    });

    await check('the new function keeps the applied signature and grants', async () => {
      const [signature] = await rows(`SELECT pg_get_function_result(oid) AS result,
        pg_get_function_arguments(oid) AS args
        FROM pg_proc WHERE proname = 'refresh_anonymous_abuse_status_by_key'`);
      assert.equal(signature.args, 'p_installation_key text');
      for (const column of ['installation_key', 'current_user_id', 'risk_score', 'decision', 'reason_code', 'cooldown_until', 'temporary_suspension_until', 'review_required']) {
        assert.equal(signature.result.includes(column), true, `missing returned column ${column}`);
      }

      const [privilege] = await rows(`SELECT has_function_privilege('authenticated','public.refresh_anonymous_abuse_status_by_key(text)','EXECUTE') AS allowed`);
      assert.equal(privilege.allowed, false, 'the refresh helper must stay callable only through the registration RPC');
      const [registrationPrivilege] = await rows(`SELECT has_function_privilege('authenticated','public.register_anonymous_abuse_identity(text)','EXECUTE') AS allowed`);
      assert.equal(registrationPrivilege.allowed, true);
    });

    await check('applying the fix migration twice stays idempotent', async () => {
      await db.exec(fs.readFileSync(migration(fixMigration), 'utf8'));
      await actor(1);
      const again = await abusePrecheck(1, raw('t1'));
      assert.equal(again.decision, 'cooldown');
      assert.equal(again.reason_code, 'cooldown_active');
    });

    console.log(`${passed} abuse cooldown regression checks passed.`);
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
