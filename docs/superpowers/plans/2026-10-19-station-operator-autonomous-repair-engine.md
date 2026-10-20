# Station Operator Autonomous Repair Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh allowlisted low-risk mailbox Bug autonomously produce a safe isolated Draft PR with required CI green, without a human locating files or writing the patch.

**Architecture:** Extend the existing Station Operator repair safety contracts with a server-side diagnosis/planning engine that receives only sanitized repair data and tightly bounded repository context. A controlled GitHub write adapter applies only validated plans to `ai-repair/<job-id>` and opens a Draft PR; CI failures may trigger one bounded second attempt, while uncertain/high-risk work fails closed to `human_review`.

**Tech Stack:** Next.js/Node.js, existing Station Operator ESM modules, OpenAI server API already configured in Vercel, GitHub API/controlled write adapter, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-station-operator-autonomous-repair-engine-design.md`

## Global Constraints

- Production remains `allowlist` during rollout.
- Never write directly to `main`.
- Every repair branch is exactly `ai-repair/<job-id>`.
- Maximum 2 automatic repair attempts.
- Only low-risk repairs may enter the engine.
- Maximum 5 changed files and 50 KB per changed file.
- Generated changes are limited to approved `apps/web` roots and may not touch workflows, migrations, env/credentials, package/lock files, Station Operator safety code, permissions, billing, or destructive data operations.
- Mailbox content is untrusted; only sanitized summaries enter the repair engine.
- The model returns structured edits only and never shell commands.
- Phase 1 creates Draft PRs but never automatically merges them.
- No mailbox `fixed` reply before approved merge, successful GitHub Actions production deployment, READY deployment, production health PASS, and idempotent finalization.
- PR #54 is a manual feasibility probe and is not an autonomous success case.
- Do not enable full production without separate explicit approval.

## Review Focus

- A short or malformed base SHA such as `abc123` must be rejected before any repository write.
- Prompt-injection text inside the mailbox summary must remain data and must not expand repository read/write scope.
- An AI plan containing a valid file plus one forbidden file must reject the entire plan with zero writes.
- Duplicate/replayed engine or CI callbacks must not create a second PR, a third attempt, or duplicate mailbox reply.
- Missing/ambiguous source evidence must transition to `human_review`, not produce a guessed patch.

---

### Task 1: Harden Repair Dispatch Identity and Base SHA

**Files:**
- Modify: `apps/web/lib/station-operator/repair-dispatch.mjs`
- Modify: `apps/web/__tests__/station-repair-dispatch.test.mjs`

**Interfaces:**
- Consumes: existing `buildRepairDispatch`, `buildRepairGitHubSteps`, `validateRepairBranchWrite`.
- Produces: exact full-SHA validation used by every privileged repair write specification.

- [ ] **Step 1: Write failing tests for exact SHA validation**

Add assertions that a 40-character hexadecimal SHA is accepted and `abc123`, 39-char, 41-char, and non-hex values are rejected by `buildRepairGitHubSteps`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd apps/web && node --test __tests__/station-repair-dispatch.test.mjs`
Expected: FAIL because the current SHA contract accepts shortened SHAs.

- [ ] **Step 3: Harden the SHA contract**

Change the base-SHA validator to exactly `/^[A-Fa-f0-9]{40}$/` and update existing successful fixtures to use a full 40-character SHA.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `cd apps/web && node --test __tests__/station-repair-dispatch.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `test: require full repair base sha`

### Task 2: Define Bounded Repository Context Discovery

**Files:**
- Create: `apps/web/lib/station-operator/repair-context.mjs`
- Create: `apps/web/__tests__/station-repair-context.test.mjs`

**Interfaces:**
- Produces: `buildRepairSearchRequest({ repairId, jobId, summary })`, `selectRepairContext({ candidates, contents })`.
- Later tasks consume the selected bounded context; this unit never writes repository state.

- [ ] **Step 1: Write failing context-boundary tests**

Test that sanitized summaries produce search terms, only approved `apps/web` source/test paths are selected, forbidden paths are excluded, candidate count/total context size are bounded, and prompt-injection phrases cannot change allowed roots.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd apps/web && node --test __tests__/station-repair-context.test.mjs`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal context discovery contracts**

Keep search requests data-only. Cap candidate files and bytes to explicit constants small enough for diagnosis; fail closed if no safe candidate remains.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the Task 2 test file; expected PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: bound autonomous repair context`

### Task 3: Parse and Validate Structured AI Repair Output

**Files:**
- Create: `apps/web/lib/station-operator/repair-engine.mjs`
- Create: `apps/web/__tests__/station-repair-engine.test.mjs`
- Modify only if necessary: `apps/web/lib/station-operator/repair-dispatch.mjs`

**Interfaces:**
- Consumes: sanitized repair request, bounded context, existing `validateRepairPlan`.
- Produces: `buildRepairModelRequest(input)`, `parseRepairModelOutput(raw)`, `prepareValidatedRepairPlan(input)` returning either a validated plan or fail-closed reason.

- [ ] **Step 1: Write failing model-contract tests**

Cover JSON-only structured edits, malformed JSON, shell-command content, mixed safe/forbidden paths, more than 5 files, >50 KB file, duplicate paths, and ambiguous/no-evidence diagnosis.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd apps/web && node --test __tests__/station-repair-engine.test.mjs`
Expected: FAIL because engine functions do not exist.

- [ ] **Step 3: Implement request/parser/validator integration**

The model request explicitly treats summary/context as untrusted data. Parsing rejects prose/code-fence responses. `prepareValidatedRepairPlan` calls the existing authoritative plan validator and returns no partial plan on any invalid edit.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Expected: all Task 3 tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: validate autonomous repair plans`

### Task 4: Add Server-side Repair Engine Endpoint

**Files:**
- Create: `apps/web/app/api/internal/station-repair/engine/route.ts`
- Create: `apps/web/__tests__/station-repair-engine-route.test.mjs`
- Modify: relevant Station Operator DB wrapper only for read/update methods required by this endpoint.

**Interfaces:**
- Consumes: authenticated repair/job ID, queued low-risk repair record, sanitized summary, bounded context builder, model-plan validator.
- Produces: one validated repair plan or a deterministic `human_review`/retry outcome; no GitHub mutation in this task.

- [ ] **Step 1: Write failing endpoint contract tests**

Cover invalid auth, missing repair, non-low-risk repair, wrong status, attempt >2, malformed model response, ambiguous diagnosis, and successful validated plan. Assert raw mailbox message content is never placed in the model request.

- [ ] **Step 2: Run focused endpoint tests and confirm RED**

Expected: endpoint contract unavailable.

- [ ] **Step 3: Implement the endpoint using existing server-side AI configuration**

Use the existing server-side OpenAI credential/configuration; do not add a new client-exposed secret. Persist only sanitized diagnosis/plan metadata needed for the state machine.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add station repair engine endpoint`

### Task 5: Implement Controlled GitHub Write Adapter Contract

**Files:**
- Create: `apps/web/lib/station-operator/repair-github.mjs`
- Create: `apps/web/__tests__/station-repair-github.test.mjs`
- Modify: `apps/web/lib/station-operator/repair-dispatch.mjs` only if shared safety helpers must be exported.

**Interfaces:**
- Consumes: validated repair plan, exact 40-char base SHA, job ID, attempt.
- Produces: an ordered write specification: create exact isolated branch, write validated files, open Draft PR targeting `main`; never merge.

- [ ] **Step 1: Write failing adapter tests**

Assert exact branch, no force, no `main` writes, Draft PR only, full-SHA requirement, zero operations on a mixed forbidden plan, and idempotent reuse of an existing repair branch/PR.

- [ ] **Step 2: Run focused tests and confirm RED**

Expected: adapter module unavailable.

- [ ] **Step 3: Implement the adapter as a capability-limited operation specification**

Do not embed unrestricted GitHub credentials or shell execution. Keep external GitHub mutation behind an injected controlled executor so tests can prove exact operations and unattended production can later bind only the required GitHub App/service capability.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: constrain autonomous repair writes`

### Task 6: Wire Attempt State Machine and Second Attempt

**Files:**
- Modify: `apps/web/lib/station-operator/worker.mjs`
- Modify: Station Operator DB/state wrapper used by repair callbacks
- Modify: `apps/web/__tests__/station-repair-callback.test.mjs`
- Create or modify: `apps/web/__tests__/station-repair-retry.test.mjs`

**Interfaces:**
- Consumes: repair-engine result, Draft PR/CI callback, sanitized CI failure summary.
- Produces: attempt 1 -> waiting_ci; CI failure -> attempt 2; second failure -> human_review; CI success -> waiting_merge.

- [ ] **Step 1: Write failing state-transition tests**

Pin attempt limits, duplicate callback idempotency, sanitized CI error handoff, no third attempt, and no mailbox fixed reply while waiting for merge.

- [ ] **Step 2: Run focused tests and confirm RED**

Expected: missing autonomous retry transitions fail.

- [ ] **Step 3: Implement minimal transitions**

Reuse existing idempotent callback/RPC patterns. Never allow a replayed callback to increment attempts twice.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: retry safe repairs once`

### Task 7: Connect Station Operator to the Autonomous Engine Without Enabling Production

**Files:**
- Modify: `apps/web/lib/station-operator/worker.mjs`
- Modify: `apps/web/lib/station-operator/runner.mjs` if orchestration boundary requires it
- Modify: `apps/web/__tests__/station-operator-worker.test.mjs`
- Modify: `apps/web/__tests__/station-operator-runner.test.mjs`

**Interfaces:**
- Consumes: low-risk bug decision and repair record.
- Produces: autonomous engine dispatch in `allowlist` only for eligible threads; dry-run and disabled remain non-mutating.

- [ ] **Step 1: Write failing orchestration tests**

Assert disabled/dry-run never invoke repair engine, allowlist rejects non-listed threads, low-risk listed bug invokes exactly once, high-risk goes human_review, and duplicate jobs do not duplicate engine dispatch.

- [ ] **Step 2: Run focused tests and confirm RED**

Expected: existing worker stops at queued/waiting_ci and does not invoke engine.

- [ ] **Step 3: Wire the engine dispatch behind existing mode/risk gates**

Keep full production behavior disabled; no environment mode changes in this task.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: dispatch allowlisted autonomous repairs`

### Task 8: Full Safety Verification and Controlled Rollout Test

**Files:**
- Modify tests only if verification exposes a defect.
- Do not merge PR #54 as part of this task.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: fresh evidence that a new controlled mailbox bug reaches Draft PR + green CI without manual file selection or patch writing.

- [ ] **Step 1: Run the complete Station Operator/repair test suite**

Run: `cd apps/web && npm run test:station-operator`
Expected: PASS.

- [ ] **Step 2: Run typecheck and production build**

Run the repository's existing typecheck and web build commands.
Expected: PASS.

- [ ] **Step 3: Verify PR branch scope**

Confirm only intended Repair Engine implementation files changed and protected paths remain untouched except the already-approved read-only validation workflow if required by existing branch history.

- [ ] **Step 4: Keep production in allowlist and create a fresh controlled Bug thread**

Do not reuse the #54 bug as proof. Allowlist only the fresh test thread.

- [ ] **Step 5: Trigger Station Operator and observe without manual repair intervention**

Expected autonomous sequence: mailbox Bug -> low-risk repair -> diagnosis/context discovery -> validated plan -> `ai-repair/<job-id>` -> Draft PR -> Repair Guard/web CI.

- [ ] **Step 6: Verify safety and autonomy evidence**

Confirm no assistant/manual branch creation or file edit occurred for the test repair, no main write occurred, exactly one Draft PR exists, attempt count <=2, and no fixed mailbox reply was sent.

- [ ] **Step 7: Verify CI outcome**

Success criterion for Phase 1: Repair Guard and required web CI are green. If attempt 1 fails, verify attempt 2 is autonomous; if attempt 2 fails, verify `human_review` and stop.

- [ ] **Step 8: Record rollout evidence and commit only verification fixes if needed**

Commit message if code/test fixes were necessary: `test: verify autonomous station repair rollout`

## Execution Boundary

This plan can implement and test all safe engine logic, model contracts, state transitions, and controlled GitHub operation specifications. Unattended production GitHub mutation requires a runtime credential/capability that can create branches, write approved files, and open Draft PRs. Do not create or modify such credentials automatically. If the repository does not already expose an appropriately scoped GitHub App/service capability at execution time, stop at that single boundary and request explicit user setup/approval rather than weakening workflow permissions or reusing a broad token.
