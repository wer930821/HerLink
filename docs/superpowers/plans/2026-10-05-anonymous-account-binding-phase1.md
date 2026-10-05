# HerLink Anonymous Account Binding Phase 1 Implementation Plan

> **For implementer:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task-by-task. Follow TDD and verification-before-completion before claiming success.

**Goal:** Let an existing anonymous Web user choose「保存我的聊天室」and convert that current Supabase anonymous auth user into a durable email/password login without changing the user's UUID, existing profile, random chat sessions, messages, recovery records, or partner-visible identity.

**Architecture:** The current HerLink schema uses `auth.users.id` directly as the anonymous identity in `profiles`, `random_chat_sessions.user_a/user_b`, queue rows and message ownership. Phase 1 therefore uses the safest compatible path: upgrade the current anonymous Supabase user in place so the UUID stays stable. This preserves every existing FK and avoids copying or rewriting chat data. The broader multi-identity `account_identities` model from the approved design remains for a later phase when multiple historical identities per account are needed; Phase 1 must not introduce a destructive identity merge.

**Tech Stack:** Next.js 16 / React 19, `@supabase/supabase-js` 2.112.x, Supabase Auth/Postgres/RLS, existing Node integration-test scripts.

---

## Scope guard

Phase 1 only implements account persistence and cross-browser login for the current anonymous identity. Server-side unread state, push subscription ownership, multi-identity account merging and admin rebind tooling remain Phases 2-4.

The implementation must never update `random_chat_sessions.user_a`, `random_chat_sessions.user_b`, `random_chat_messages.sender_id`, existing message IDs, session IDs, anonymous display names or recovery codes during binding.

### Task 1: Add regression coverage for identity preservation

**Files:**
- Create: `work/account-binding-phase1-test.mjs`
- Reference: `work/web-v01-supabase-test.mjs`
- Reference: `supabase/migrations/20260829120000_web_v01_random_matching.sql`

**Step 1: Write the failing integration test**

Create a focused test that:
1. creates/signs in an anonymous user using the same public auth path as Web;
2. creates an anonymous profile and a chat/session fixture with another test user;
3. records the anonymous user's UUID, session ID, message IDs and anonymous display name;
4. upgrades the anonymous user with a unique test email/password;
5. signs out, creates a fresh Supabase client and signs back in with that email/password;
6. asserts the returned user UUID is exactly the original anonymous UUID;
7. asserts the same profile/session/messages are readable and unchanged;
8. asserts a third-party user still cannot read that session;
9. cleans up only test-created rows/users.

Do not use broad `delete().neq(...)` cleanup against shared environments.

**Step 2: Run test and confirm it fails before helper/UI implementation**

Run: `node work/account-binding-phase1-test.mjs`
Expected: FAIL at the missing account-upgrade helper or unsupported test setup, while existing chat data remains untouched.

**Step 3: Commit**

`git add work/account-binding-phase1-test.mjs && git commit -m "test: cover anonymous account upgrade preservation"`

### Task 2: Add Web auth helpers for in-place anonymous upgrade

**Files:**
- Modify: `apps/web/lib/supabase.ts`
- Modify: `apps/web/lib/auth-ui.ts`
- Test: `work/account-binding-phase1-test.mjs`

**Step 1: Add auth-state helpers**

In `apps/web/lib/supabase.ts`, add small helpers such as:
- `isAnonymousSession(session)` using Supabase user metadata/identity state rather than profile name;
- `saveAnonymousAccount(email, password)` which refuses to run without a current anonymous session and upgrades that same authenticated user with `supabase.auth.updateUser({ email, password })`;
- return the resulting user/session without creating a second user.

Never call `signUp()` from the save-current-chat flow because that would create a different UUID and orphan the current chat ownership.

**Step 2: Add friendly binding errors**

Extend `apps/web/lib/auth-ui.ts` for already-registered email, invalid email, weak password, reauthentication/session loss and email-rate-limit cases. The generic failure text for this flow must be: `帳號尚未完成綁定，你目前的匿名聊天室沒有受到影響。`

**Step 3: Run focused test**

Run: `node work/account-binding-phase1-test.mjs`
Expected: PASS for UUID/session/message preservation and fresh-client login.

**Step 4: Run Web typecheck**

Run: `npm run typecheck --prefix apps/web`
Expected: PASS.

**Step 5: Commit**

`git add apps/web/lib/supabase.ts apps/web/lib/auth-ui.ts work/account-binding-phase1-test.mjs && git commit -m "feat(web): preserve anonymous identity when saving account"`

### Task 3: Add「保存我的聊天室」UI without creating a login wall

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/globals.css` only if existing panel/modal classes are insufficient

**Step 1: Add binding state to the existing homepage**

When the current Supabase session is anonymous and the anonymous profile is ready, show a low-priority action `保存我的聊天室`. Keep `開始匿名聊天` unchanged for users with no session.

Do not automatically redirect anonymous users to `/login` or `/signup`.

**Step 2: Add the save form**

Use an inline panel/modal with:
- explanation: `綁定後，換手機或清除瀏覽器資料也能重新登入找回聊天室。你的登入帳號不會顯示給聊天對象。`
- email field;
- password field;
- primary action `保存聊天室`;
- cancel action.

On submit call `saveAnonymousAccount`. On success refresh the auth session and show `聊天室已保存` without resetting onboarding or anonymous name.

On failure keep the current session/profile intact and show the safe failure message.

**Step 3: Adjust logout semantics**

For a saved account, `登出` is allowed because email/password can restore it. For an unsaved anonymous session, do not present a destructive-looking normal logout without warning; either hide it or require a warning that leaving may lose browser access and point to `保存我的聊天室` first.

**Step 4: Verify existing redirects**

Ensure homepage bootstrap still routes active sessions to `/session/[id]` and waiting users to `/waiting`, and binding UI does not interfere with these paths.

**Step 5: Run checks**

Run:
- `npm run typecheck --prefix apps/web`
- `npm run build --prefix apps/web`

Expected: both PASS.

**Step 6: Commit**

`git add apps/web/app/page.tsx apps/web/app/globals.css && git commit -m "feat(web): add save-my-chat account binding"`

### Task 4: Make login restore the existing anonymous profile cleanly

**Files:**
- Modify: `apps/web/app/login/page.tsx`
- Modify: `apps/web/app/signup/page.tsx`
- Modify: `apps/web/app/onboarding/page.tsx` only if required by redirect behavior

**Step 1: Fix login copy and redirect behavior**

The current login copy says users will go through anonymous setup after login. Change it so returning saved users understand that login restores their saved anonymous identity/chatrooms.

After successful login, route to `/`; the existing homepage bootstrap should load the existing profile and active chat. Do not force `/onboarding` when the restored profile is already complete.

**Step 2: Separate new registration from save-current-chat**

Keep `/signup` only for users intentionally creating a fresh account with no current anonymous identity. If an anonymous session is already active, the page should send them back to the save-current-chat flow instead of creating a new auth user.

**Step 3: Regression checks**

Verify:
- fresh visitor -> anonymous chat still works;
- saved user -> sign out -> sign in -> same UUID/profile/chat;
- unsaved anonymous user -> `/signup` cannot silently replace current identity;
- existing 8-code recovery entry remains reachable from homepage when signed out.

**Step 4: Run Web checks**

Run:
- `npm ci --prefix apps/web`
- `npm run typecheck --prefix apps/web`
- `npm run build --prefix apps/web`

Expected: all PASS.

**Step 5: Commit**

`git add apps/web/app/login/page.tsx apps/web/app/signup/page.tsx apps/web/app/onboarding/page.tsx && git commit -m "fix(web): restore saved anonymous identity on login"`

### Task 5: Verify production-safety invariants before deployment

**Files:**
- Modify: `docs/HERLINK_WORKSPACE.md`
- Reference: `supabase/config.toml`
- Test: `work/account-binding-phase1-test.mjs`

**Step 1: Check hosted Auth settings before exposing UI**

Confirm the production Supabase project has anonymous sign-ins enabled because the Web already calls `signInAnonymously()`. Confirm email/password sign-in is enabled. Do not commit provider secrets.

Note: repository-local `supabase/config.toml` currently has `enable_anonymous_sign_ins = false`; align local test configuration only if local integration testing needs it, but do not treat that file as proof of hosted production state.

**Step 2: Run non-destructive invariants**

Before/after the binding test, verify counts and identifiers for the test fixture only. For production rollout, use read-only queries to confirm:
- existing `random_chat_sessions` count is unchanged by the migration/deploy;
- existing `random_chat_messages` count is unchanged;
- no session participant IDs are rewritten by account binding;
- recovery tables/functions still exist and remain callable under their prior authorization rules.

Phase 1 should require no destructive data migration. If implementation discovers a need to rewrite existing chat ownership, STOP and revise the design instead.

**Step 3: Full verification**

Run:
- `node work/account-binding-phase1-test.mjs`
- `npm ci --prefix apps/web`
- `npm run typecheck --prefix apps/web`
- `npm run build --prefix apps/web`

Then manually verify in a clean browser profile:
1. start anonymously;
2. set anonymous name;
3. create/use a chat;
4. save with email/password;
5. sign out;
6. sign in from another browser profile;
7. confirm same anonymous name and same chat/session history;
8. confirm partner sees no email/account information.

**Step 4: Update workspace handoff**

Document Phase 1 status, exact verification commands/results and final commit in `docs/HERLINK_WORKSPACE.md`.

**Step 5: Commit and deploy**

Commit only after all verification passes. Push to `master`; Web deployment remains Vercel via GitHub. Do not use EAS Build.

After production deployment, smoke-test homepage, anonymous entry, save flow, login restore, existing chat access and 8-code recovery. If save/login fails, disable/hide the save UI first; do not roll back by deleting user/chat data.
