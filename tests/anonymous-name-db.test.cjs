const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migration = path.join(
  root,
  'supabase/migrations/20260919043535_repair_anonymous_name_rotation.sql'
);
const uid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

async function actor(db, n, role = 'authenticated') {
  await db.exec(
    `RESET ROLE; SELECT set_config('request.jwt.claim.sub','${n ? uid(n) : ''}',false); SET ROLE ${role};`
  );
}

test('anonymous name RPCs keep a large unique server-side pool available', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'security-fixture.sql'), 'utf8'));
    await db.exec(`
      ALTER TABLE public.profiles ADD COLUMN anonymous_display_name_normalized TEXT;
      CREATE UNIQUE INDEX profiles_anonymous_display_name_normalized_unique
      ON public.profiles(anonymous_display_name_normalized)
      WHERE anonymous_display_name_normalized IS NOT NULL;
      CREATE FUNCTION public.sync_legacy_alias() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.anonymous_display_name_normalized := lower(NEW.anonymous_display_name);
        RETURN NEW;
      END $$;
      CREATE TRIGGER sync_legacy_alias BEFORE INSERT OR UPDATE OF anonymous_display_name
      ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_alias();
    `);
    await db.exec(fs.readFileSync(migration, 'utf8'));
    await db.exec(`
      INSERT INTO auth.users
      SELECT (lpad(n::text, 8, '0') || '-0000-4000-8000-000000000000')::uuid
      FROM generate_series(1, 80) n;
      INSERT INTO profiles(id)
      SELECT id FROM auth.users;
    `);
    await db.exec(`UPDATE profiles SET anonymous_display_name = '原本的稱號' WHERE id = '${uid(1)}'`);

    const names = new Set();
    for (let n = 2; n <= 80; n += 1) {
      await actor(db, n);
      const result = (await db.query('SELECT * FROM rotate_my_anonymous_display_name()')).rows[0];
      assert.equal(result.status, 'OK');
      assert.match(result.anonymous_display_name, /^.+[0-9]{4}$/u);
      assert.equal(names.has(result.anonymous_display_name), false);
      names.add(result.anonymous_display_name);
    }
    await db.exec('RESET ROLE');
    const original = (await db.query(`SELECT anonymous_display_name FROM profiles WHERE id = '${uid(1)}'`)).rows[0];
    assert.equal(original.anonymous_display_name, '原本的稱號');
  } finally {
    await db.close();
  }
});

test('anonymous name RPCs are unavailable to unauthenticated callers', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'security-fixture.sql'), 'utf8'));
    await db.exec('ALTER TABLE public.profiles ADD COLUMN anonymous_display_name_normalized TEXT');
    await db.exec(fs.readFileSync(migration, 'utf8'));
    await actor(db, null, 'anon');
    await assert.rejects(db.query('SELECT * FROM rotate_my_anonymous_display_name()'), /permission denied/i);
  } finally {
    await db.close();
  }
});
