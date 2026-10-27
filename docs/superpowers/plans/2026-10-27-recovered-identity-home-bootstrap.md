# Recovered Identity Home Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a browser whose auth user has been rebound to an existing anonymous identity resolves that identity before deciding whether to show an active chat or historical chats.

**Architecture:** Keep canonical identity resolution server-side through existing effective-identity RPCs. The home bootstrap will distinguish recovered identities (`effective profile id !== auth uid`), re-check the active session after effective profile resolution, and expose the existing chats/history route when no active session exists. It must never rewrite session participants, messages, contacts, or turn ended sessions active.

**Tech Stack:** Next.js, React, TypeScript, Supabase RPC, Node tests.

**Spec:** User-approved recovery behavior in the 2026-10-27 conversation.

## Global Constraints

- Preserve the existing anonymous identity and historical ownership.
- Do not move or rewrite chat/message/contact IDs.
- Do not reactivate ended sessions.
- Do not re-run a recovery code during bootstrap.
- Preserve SAME_IDENTITY and conflict protections.

## Review Focus

- Normal anonymous users whose profile id equals auth uid must behave exactly as before.
- Recovered users with an active session must resolve and enter that session.
- Recovered users with only ended/history sessions must not be rematched or reactivated.
- RPC errors must not create a new identity or overwrite recovered data.
- Repeated refreshes must be idempotent.

---

### Task 1: Pin recovered-home bootstrap behavior

**Files:**
- Create: `apps/web/__tests__/recovered-identity-home-bootstrap.test.mjs`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `loadMyProfile(userId)`, `loadMyActiveRandomSession()`, effective profile `id`, auth session user `id`.
- Produces: recovered-identity bootstrap branch that retries active-session lookup only after effective profile resolution and leaves ended/history data untouched.

- [ ] **Step 1: Write the failing test**

Assert that home bootstrap detects `profileResult.data?.id !== session.user.id`, performs a post-resolution `loadMyActiveRandomSession()` lookup, does not call recovery/restore RPCs, and routes an active result through the existing active-session state.

- [ ] **Step 2: Run test to verify it fails**

Run the focused Node test and confirm the recovered-identity retry assertion fails before production changes.

- [ ] **Step 3: Implement the minimal bootstrap change**

After effective profile resolution, if the effective identity differs from auth uid and the first active lookup returned no session without an RPC error, retry `loadMyActiveRandomSession()` once. Use the retried result for diagnostics/state. Do not mutate database records.

- [ ] **Step 4: Run focused and related tests**

Run the new test plus existing permanent-recovery/navigation tests; expected PASS.

- [ ] **Step 5: Commit**

Commit the test and minimal implementation on the fix branch.
