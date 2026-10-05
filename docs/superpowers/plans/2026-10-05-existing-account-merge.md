# Existing Account Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely merge a HerLink anonymous identity into an already-registered Supabase account while preserving all chat ownership and history.

**Architecture:** Verify the target account first, then call a trusted server-side transaction that migrates UUID ownership with explicit conflict handling and before/after verification. Keep the browser anonymous session recoverable until the transaction succeeds; never expose privileged keys client-side.

**Tech Stack:** Next.js/TypeScript, Supabase Auth, PostgreSQL/RLS/RPC, Node contract/integration tests.

**Spec:** `docs/superpowers/specs/2026-10-05-existing-account-merge-design.md`

## Global Constraints
- Preserve current anonymous UUID data until merge success.
- No service-role key in browser code.
- One transaction; any unresolved conflict rolls back all mutations.
- Preserve session/message IDs and unrelated users.
- Do not use 孤星企鵝 production rows as test fixtures.

## Review Focus
- Existing account has its own HerLink data: merge without data loss.
- Source and target already share a contact/session-related unique key: deterministic conflict handling.
- Failure halfway through ownership changes: full rollback.
- Wrong existing-account password/account: zero database mutation and anonymous session restoration.
- Newly added ownership table is not covered: fail closed rather than silently orphan data.

---

### Task 1: Schema ownership inventory and failing merge contract
**Files:**
- Create: `apps/web/lib/existing-account-merge.test.mjs`
- Create: `supabase/tests/existing_account_merge.sql`

- [ ] Inventory current UUID ownership/reference columns and unique constraints for HerLink identity tables.
- [ ] Write failing contract tests requiring transaction RPC, authorization checks, coverage guard, rollback behavior, and no client-side privileged key.
- [ ] Run tests and observe failure before implementation.

### Task 2: Transaction-safe database merge
**Files:**
- Create: migration under the repository's existing Supabase migration convention.
- Modify tests from Task 1.

- [ ] Implement a server-only merge function/RPC with source/target validation and row locking.
- [ ] Add deterministic conflict resolution for contacts/read/progress rows.
- [ ] Add a coverage guard that aborts when known identity ownership references are not handled.
- [ ] Return before/after counts for verification.
- [ ] Run SQL/integration tests to green.

### Task 3: Trusted server endpoint and auth proof
**Files:**
- Create/modify a focused Next.js server route/helper following current repository patterns.
- Test with a dedicated route/helper contract test.

- [ ] Write failing tests for wrong password, wrong source session, wrong target account, and merge failure.
- [ ] Verify existing-account credentials without persisting password.
- [ ] Invoke the transaction only after both identities are proven.
- [ ] Ensure error paths do not strand the browser on the wrong session.
- [ ] Run tests to green.

### Task 4: Existing-email UI flow
**Files:**
- Modify: `apps/web/app/formal-account-binding.tsx`
- Modify/create focused UI contract tests.

- [ ] Write failing UI contract for `email already registered` branch.
- [ ] Replace raw Supabase error with Chinese flow: `此 Email 已有帳號` → verify existing account → merge.
- [ ] Do not sign out the anonymous session before server merge success.
- [ ] On success reload into target account; on failure retain/recover anonymous session and show actionable error.
- [ ] Run typecheck/build/contracts.

### Task 5: Isolated integration verification and release gate
**Files:**
- Extend integration fixture/scripts and CI workflow only as required.

- [ ] Create isolated source anonymous user + existing target account fixture.
- [ ] Seed sessions/messages/contacts/read/recovery/progress plus an unrelated third user.
- [ ] Prove stable session/message IDs and ownership counts after merge.
- [ ] Prove forced conflict causes rollback with identical pre/post snapshot.
- [ ] Prove target login sees merged data and third-user data is unchanged.
- [ ] Run full Web Build and merge-specific integration checks.
- [ ] Deploy Preview and verify runtime errors before any Production promotion.
