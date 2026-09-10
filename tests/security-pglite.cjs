// Isolated PostgreSQL tests for the new migrations, not a full Supabase stack.
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const uid = n => `${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;

(async () => {
  const db = new PGlite();
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  const rows = async sql => (await db.query(sql)).rows;
  const actor = async (n, role = 'authenticated') => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${n ? uid(n) : ''}',false); SET ROLE ${role};`);
  };
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'security-fixture.sql'), 'utf8'));
    for (const file of ['20260905090000_sweep_privacy_presence.sql','20260905091000_sweep_queue_fairness.sql','20260905092000_sweep_anonymous_visibility.sql','20260909103000_web_matchmaking_presence_liveness.sql','20260909113000_android_unique_anonymous_names.sql','20260909114000_android_anonymous_alias_session_signal.sql','20260910090000_android_anonymous_name_length.sql']) {
      await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    }
    await db.exec(`INSERT INTO auth.users SELECT ('0000000' || n || '-0000-4000-8000-000000000000')::uuid FROM generate_series(1,6) n;
      INSERT INTO profiles(id,display_name,anonymous_display_name,bio,anonymous_intro) SELECT id,'REAL NAME','N' || substring(id::text FROM 1 FOR 8),'private@example.com','Safe intro' FROM auth.users;
      GRANT SELECT ON public.public_profiles TO authenticated;`);

    await check('anonymous public projection masks real name and biography', async () => {
      await actor(1);
      const profile = (await rows(`SELECT * FROM public_profiles WHERE id='${uid(2)}'`))[0];
      assert.equal(profile.display_name,`N${uid(2).slice(0,8)}`); assert.equal(profile.bio,'Safe intro');
    });
    await check('block applies even to direct public view queries', async () => {
      await db.exec(`RESET ROLE; INSERT INTO blocks VALUES ('${uid(1)}','${uid(2)}');`);
      await actor(1); assert.equal((await rows(`SELECT * FROM public_profiles WHERE id='${uid(2)}'`)).length,0);
      assert.equal((await rows(`SELECT * FROM get_safe_anonymous_profiles(ARRAY['${uid(2)}'::uuid])`)).length,0);
    });
    await check('cleanup RPCs cannot be called by ordinary users', async () => {
      for(const fn of ['cleanup_stale_random_queue(interval)','cleanup_chat_media_orphans(interval)','join_random_match_internal(uuid,uuid)']) {
        const [row] = await rows(`SELECT has_function_privilege('authenticated','public.${fn}','EXECUTE') AS allowed`);
        assert.equal(row.allowed,false);
      }
    });
    await check('online count deduplicates devices, excludes guests and expires activity', async () => {
      await actor(1); await db.exec(`SELECT touch_online_activity('${uid(4)}'); SELECT touch_online_activity('${uid(5)}');`);
      await actor(2); await db.exec(`SELECT touch_online_activity('${uid(6)}');`);
      await actor(null,'anon'); assert.equal((await rows('SELECT get_online_user_count() AS n'))[0].n,2);
      await db.exec(`RESET ROLE; UPDATE online_activity SET seen_at=now()-INTERVAL '91 seconds' WHERE user_id='${uid(2)}';`);
      await actor(null,'anon'); assert.equal((await rows('SELECT get_online_user_count() AS n'))[0].n,1);
      await assert.rejects(db.query('SELECT * FROM online_activity'), /permission denied/);
      await assert.rejects(db.query(`SELECT touch_online_activity('${uid(3)}')`), /permission denied/);
    });
    await check('banned users cannot heartbeat or count as active', async () => {
      await db.exec(`RESET ROLE; UPDATE profiles SET account_status='banned' WHERE id='${uid(1)}';`);
      await actor(1); await assert.rejects(db.query(`SELECT touch_online_activity('${uid(4)}')`), /not available/);
      assert.equal((await rows('SELECT get_online_user_count() AS n'))[0].n,0);
      assert.equal((await rows('SELECT * FROM public_profiles')).length,0);
      assert.equal((await rows(`SELECT * FROM get_safe_anonymous_profiles(ARRAY['${uid(3)}'::uuid])`)).length,0);
      await db.exec(`RESET ROLE; UPDATE profiles SET account_status='active' WHERE id='${uid(1)}';`);
    });
    const sessionId = uid(6);
    await check('Realtime signals contain no participant IDs; raw tables are hidden', async () => {
      await db.exec(`INSERT INTO random_chat_sessions(id,user_a,user_b,status) VALUES ('${sessionId}','${uid(3)}','${uid(4)}','active');
        INSERT INTO random_chat_messages(id,session_id,sender_id,content) VALUES ('${uid(5)}','${sessionId}','${uid(3)}','hello');`);
      await actor(3);
      const [signal] = await rows('SELECT * FROM random_chat_signals');
      assert.deepEqual(Object.keys(signal).sort(),['revision','session_id']); assert.equal(Number(signal.revision),2);
      assert.equal((await rows('SELECT * FROM random_chat_messages')).length,0);
      assert.equal((await rows('SELECT * FROM random_chat_sessions')).length,0);
      await actor(5); assert.equal((await rows('SELECT * FROM random_chat_signals')).length,0);
    });
    await check('banned session members cannot read safe signals', async () => {
      await db.exec(`RESET ROLE; UPDATE profiles SET account_status='banned' WHERE id='${uid(3)}';`);
      await actor(3); assert.equal((await rows('SELECT * FROM random_chat_signals')).length,0);
    });
    await check('active queue members stay eligible after their queue timestamp expires', async () => {
      await db.exec(`RESET ROLE; DELETE FROM blocks; INSERT INTO random_match_queue VALUES
        ('${uid(1)}','waiting',now()-INTERVAL '2 minutes',now()-INTERVAL '91 seconds',NULL),
        ('${uid(2)}','waiting',now()-INTERVAL '1 minute',now(),NULL);`);
      await db.exec(`DELETE FROM online_activity;
        INSERT INTO online_activity(user_id,instance_id,seen_at) VALUES
          ('${uid(1)}','${uid(1)}',now()-INTERVAL '91 seconds'),
          ('${uid(2)}','${uid(2)}',now());`);
      const [result] = await rows(`SELECT * FROM join_random_match_internal('${uid(5)}',NULL)`);
      assert.equal(result.status,'matched'); assert.equal(result.matched_user_id,null);
      const [session] = await rows(`SELECT * FROM random_chat_sessions WHERE id='${result.session_id}'`);
      assert.ok([session.user_a,session.user_b].includes(uid(2)));
      await db.exec(`UPDATE random_match_queue SET joined_at=now()-INTERVAL '3 minutes',updated_at=now() WHERE user_id='${uid(1)}';`);
      const before=(await rows(`SELECT joined_at FROM random_match_queue WHERE user_id='${uid(1)}'`))[0].joined_at;
      await rows(`SELECT * FROM join_random_match_internal('${uid(1)}',NULL)`);
      const after=(await rows(`SELECT joined_at FROM random_match_queue WHERE user_id='${uid(1)}'`))[0].joined_at;
      assert.equal(new Date(before).getTime(),new Date(after).getTime());
    });
    await check('stale queue cleanup follows activity instead of queue writes', async () => {
      await db.exec(`RESET ROLE;
        INSERT INTO random_match_queue VALUES
          ('${uid(3)}','waiting',now()-INTERVAL '5 minutes',now()-INTERVAL '5 minutes',NULL),
          ('${uid(4)}','waiting',now()-INTERVAL '5 minutes',now()-INTERVAL '5 minutes',NULL)
        ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status,joined_at=EXCLUDED.joined_at,updated_at=EXCLUDED.updated_at,matched_session_id=NULL;
        INSERT INTO online_activity(user_id,instance_id,seen_at) VALUES
          ('${uid(3)}','${uid(3)}',now()-INTERVAL '91 seconds'),
          ('${uid(4)}','${uid(4)}',now())
        ON CONFLICT (user_id,instance_id) DO UPDATE SET seen_at=EXCLUDED.seen_at;
        SELECT cleanup_stale_random_queue();`);
      const queueRows = await rows(`SELECT user_id,status FROM random_match_queue WHERE user_id IN ('${uid(3)}','${uid(4)}') ORDER BY user_id`);
      assert.equal(queueRows[0].status,'left');
      assert.equal(queueRows[1].status,'waiting');
    });
    await check('anonymous alias RPC normalizes and rejects global collisions', async () => {
      await actor(1);
      const [minimum] = await rows(`SELECT * FROM set_my_anonymous_display_name('阿鵝')`);
      assert.equal(minimum.status, 'OK');
      const [maximum] = await rows(`SELECT * FROM set_my_anonymous_display_name('abcdefghijkl')`);
      assert.equal(maximum.status, 'OK');
      const [first] = await rows(`SELECT * FROM set_my_anonymous_display_name(' 阿鵝   ')`);
      assert.equal(first.status, 'OK'); assert.equal(first.anonymous_display_name, '阿鵝');
      await actor(2);
      const [duplicate] = await rows(`SELECT * FROM set_my_anonymous_display_name('阿鵝')`);
      assert.equal(duplicate.status, 'NAME_TAKEN');
      const [spacedDuplicate] = await rows(`SELECT * FROM set_my_anonymous_display_name(' 阿鵝 ')`);
      assert.equal(spacedDuplicate.status, 'NAME_TAKEN');
      await actor(3);
      const [english] = await rows(`SELECT * FROM set_my_anonymous_display_name('HerLink')`);
      assert.equal(english.status, 'OK');
      await actor(4);
      const [englishDuplicate] = await rows(`SELECT * FROM set_my_anonymous_display_name(' HERLINK ')`);
      assert.equal(englishDuplicate.status, 'NAME_TAKEN');
      await assert.rejects(db.query(`SELECT * FROM set_my_anonymous_display_name('A')`), /TOO_SHORT/);
      await assert.rejects(db.query(`SELECT * FROM set_my_anonymous_display_name('abcdefghijklm')`), /TOO_LONG/);
      await assert.rejects(db.query(`SELECT * FROM set_my_anonymous_display_name(E'bad\\nname')`), /INVALID_NAME/);
      const before = (await rows(`SELECT anonymous_display_name FROM profiles WHERE id='${uid(4)}'`))[0].anonymous_display_name;
      const [renameCollision] = await rows(`SELECT * FROM set_my_anonymous_display_name('HerLink')`);
      const after = (await rows(`SELECT anonymous_display_name FROM profiles WHERE id='${uid(4)}'`))[0].anonymous_display_name;
      assert.equal(renameCollision.status, 'NAME_TAKEN'); assert.equal(after, before);
    });
    await check('anonymous alias validation, whitespace canonicalization, and randomized aliases are safe', async () => {
      await actor(5);
      const [spaced] = await rows(`SELECT * FROM set_my_anonymous_display_name('月亮   小鵝')`);
      assert.equal(spaced.status, 'OK');
      assert.equal(spaced.anonymous_display_name, '月亮 小鵝');
      await actor(6);
      const [duplicate] = await rows(`SELECT * FROM set_my_anonymous_display_name(' 月亮 小鵝 ')`);
      assert.equal(duplicate.status, 'NAME_TAKEN');
      for (const value of ["", "   ", "A", "x".repeat(13), "bad\t\u0001name"]) {
        await assert.rejects(db.query(`SELECT * FROM set_my_anonymous_display_name($1)`, [value]), /TOO_SHORT|TOO_LONG|INVALID_NAME/);
      }
      const [random] = await rows('SELECT * FROM rotate_my_anonymous_display_name()');
      assert.equal(random.status, 'OK');
      assert.ok(random.anonymous_display_name);
      const [stored] = await rows(`SELECT anonymous_display_name_normalized FROM profiles WHERE id='${uid(6)}'`);
      assert.equal(stored.anonymous_display_name_normalized, random.anonymous_display_name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase());

      const generated = [];
      for (let index = 0; index < 100; index += 1) {
        const [rotated] = await rows('SELECT * FROM rotate_my_anonymous_display_name()');
        assert.equal(rotated.status, 'OK');
        generated.push(rotated.anonymous_display_name);
      }
      assert.equal(generated.length, 100);
      assert.ok(generated.every((name) => name.length >= 4 && name.length <= 10));
      assert.ok(generated.filter((name) => name.length <= 8).length >= 90);
      assert.ok(generated.every((name) => !name.includes('星河') && !name.startsWith('小')));
      assert.ok(generated.every((name) => !/[，。！？]/u.test(name)));

      // Replay the same first random draw after another profile claims it: the
      // RPC must retry the server pool rather than return a fallback alias.
      await actor(5);
      await rows('SELECT setseed(0.5)');
      const [firstDraw] = await rows('SELECT * FROM rotate_my_anonymous_display_name()');
      await rows(`SELECT * FROM set_my_anonymous_display_name('保留名稱')`);
      await actor(6);
      const [claim] = await rows(`SELECT * FROM set_my_anonymous_display_name('${firstDraw.anonymous_display_name}')`);
      assert.equal(claim.status, 'OK');
      await actor(5);
      await rows('SELECT setseed(0.5)');
      const [retried] = await rows('SELECT * FROM rotate_my_anonymous_display_name()');
      assert.equal(retried.status, 'OK');
      assert.notEqual(retried.anonymous_display_name, firstDraw.anonymous_display_name);
    });
    await check('competing aliases leave exactly one owner and preserve the losing alias', async () => {
      await actor(5); await rows(`SELECT * FROM set_my_anonymous_display_name('原本名稱')`);
      const competingName = '同步搶名';
      const [winnerResult] = await rows(`SELECT * FROM set_my_anonymous_display_name('${competingName}')`);
      await actor(6);
      const [loserResult] = await rows(`SELECT * FROM set_my_anonymous_display_name('${competingName}')`);
      assert.equal(winnerResult.status, 'OK');
      assert.equal(loserResult.status, 'NAME_TAKEN');
      await db.exec('RESET ROLE;');
      const [winner] = await rows(`SELECT anonymous_display_name FROM profiles WHERE anonymous_display_name_normalized=lower('${competingName}')`);
      assert.equal(winner.anonymous_display_name, competingName);
    });
    console.log(`${passed} PostgreSQL regression checks passed.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
