# Stable Admin Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin recovery preserve the original anonymous identity and bind the current auth principal back to it without migrating chat data.

**Architecture:** Replace the legacy data-migration semantics of admin recovery with stable identity binding through `anonymous_identity_device_state`. Keep the existing admin UI contract and legacy recovery-code workflow, but make the database operation transactional, idempotent, and conflict-safe.

**Tech Stack:** PostgreSQL/Supabase PL/pgSQL, Next.js/TypeScript Supabase client, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-20-stable-admin-recovery-design.md`

## Global Constraints

- Original anonymous `profiles.id` remains canonical.
- Do not migrate chats, messages, contacts, or the original display name to a replacement profile.
- Legacy 8-character admin recovery remains supported.
- Recovery conflicts must fail without partial identity mutation.
- Development must not mutate production data.

## Review Focus

- Current auth principal already mapped to another anonymous identity: recovery must replace only the stale auth mapping and preserve canonical chat data.
- Recovery retry after success: must remain idempotent and keep the same canonical identity.
- Requester equals opposite chat participant: must reject recovery.
- Missing profile/session or invalid side: must reject without mutation.
- Unique device-state conflict: must roll back and return an administrator-readable error.

---

### Task 1: Pin stable admin recovery behavior with failing tests

**Files:**
- Create: `apps/web/__tests__/admin-recovery-stable-identity.test.mjs`
- Reference: `supabase/migrations/20261009003000_admin_recovery_stable_identity.sql`
- Reference: `apps/web/lib/supabase.ts`

**Interfaces:**
- Consumes: existing `approveAdminRecoveryRequest(code, side)` admin client action.
- Produces: executable assertions that forbid chat-data migration and require original-identity device binding.

- [ ] **Step 1: Write failing tests** asserting the recovery migration binds `anonymous_identity_id = v_source` and `active_auth_user_id = p_target_user_id`, does not rename/archive the source profile, and does not update sessions/messages/contacts from source to target.
- [ ] **Step 2: Add tests** for idempotent retry, invalid/opposite side rejection, stale auth mapping replacement, and readable unique-conflict rollback.
- [ ] **Step 3: Run** `node --test apps/web/__tests__/admin-recovery-stable-identity.test.mjs` and verify RED against the current migration.
- [ ] **Step 4: Commit** the failing tests.

### Task 2: Replace migration semantics with stable identity binding

**Files:**
- Create: `supabase/migrations/20261020_admin_recovery_preserve_original_identity.sql`
- Test: `apps/web/__tests__/admin-recovery-stable-identity.test.mjs`

**Interfaces:**
- Consumes: `p_session_id uuid`, `p_side text`, `p_target_user_id uuid`.
- Produces: `public.admin_restore_random_session_to_user(...) returns public.random_chat_sessions` with stable-binding semantics.

- [ ] **Step 1: Implement** a replacement `admin_restore_random_session_to_user` that resolves and locks the session, determines `v_source`, validates profiles/opposite participant, and leaves source-owned chat data unchanged.
- [ ] **Step 2: Implement** device-state takeover: remove a stale row for `active_auth_user_id=p_target_user_id` when it belongs to another identity, then upsert `(anonymous_identity_id=v_source, active_auth_user_id=p_target_user_id)` and increment generation on retry.
- [ ] **Step 3: Keep** unique-violation handling transactional and return a clear recovery-conflict exception.
- [ ] **Step 4: Run** the focused test and verify GREEN.
- [ ] **Step 5: Commit** migration + passing tests.

### Task 3: Verify legacy admin client compatibility

**Files:**
- Modify only if required: `apps/web/lib/supabase.ts`
- Test: `apps/web/__tests__/admin-recovery-stable-identity.test.mjs`

**Interfaces:**
- Consumes: legacy recovery code and selected side from admin UI.
- Produces: unchanged admin-call surface while backend semantics become stable identity recovery.

- [ ] **Step 1: Add a failing assertion** that `approveAdminRecoveryRequest` remains wired to the supported admin recovery RPC path and does not introduce a second client-side identity migration path.
- [ ] **Step 2: Make the minimum client change only if the new RPC contract requires it.**
- [ ] **Step 3: Run** the focused tests and existing permanent-recovery UI tests.
- [ ] **Step 4: Commit** any required client/test changes.

### Task 4: Strengthen GitHub verification

**Files:**
- Modify: `.github/workflows/verify-admin-recovery-stable-identity.yml`

**Interfaces:**
- Consumes: new migration and focused Node test.
- Produces: CI failure if admin recovery regresses to moving source identity data into the current auth profile.

- [ ] **Step 1: Add CI checks** for the new migration and focused test.
- [ ] **Step 2: Explicitly verify** the migration contains source-identity device binding and does not contain the old source-to-target session/message/contact migration statements.
- [ ] **Step 3: Run/inspect workflow syntax and focused tests.**
- [ ] **Step 4: Commit** workflow changes.

### Task 5: Final regression verification

**Files:** No production files expected beyond prior tasks.

- [ ] **Step 1: Run** `node --test apps/web/__tests__/admin-recovery-stable-identity.test.mjs`.
- [ ] **Step 2: Run** `node --test apps/web/__tests__/permanent-recovery-ui.test.mjs`.
- [ ] **Step 3: Verify** the existing stable-identity workflow requirements still hold.
- [ ] **Step 4: Review diff** to confirm no production data scripts, hard-coded user IDs, or one-off repair data entered the branch.
- [ ] **Step 5: Open/update Draft PR** from `fix/stable-admin-recovery` to `main`; do not merge until CI passes.