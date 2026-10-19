# ChatGPT Station Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 HerLink 站長信箱可被安全的自動站長工作流程定期處理：分類客服與 Bug、產生回覆、建立維修工作，並留下完整稽核紀錄。

**Architecture:** 站長信箱仍以 Supabase `station_mail_threads/messages` 為唯一來源。新增 server-only operator API 與工作佇列；排程只呼叫受 secret 保護的入口。AI 只能透過白名單 action 產生決策，不直接取得 service-role key、SQL 或部署權限。程式修復使用 GitHub 隔離分支/PR，CI 成功才允許進一步發布。

**Tech Stack:** Next.js 16, TypeScript, Supabase, OpenAI Responses API, GitHub Actions/Vercel Cron compatible HTTP endpoint.

**Spec:** `docs/superpowers/plans/2026-10-19-chatgpt-station-operator.md`

## Global Constraints

- 不把 Supabase service-role key、OpenAI key、GitHub token 傳給瀏覽器或模型。
- 所有自動回覆、分類、修復工作、失敗與人工接管都必須有 audit log。
- 同一工作最多自動嘗試 2 次。
- Bug 修復不得直接修改 `main`；使用 `ai-repair/*` 隔離分支並經 CI。
- 永久刪除、大量資料異動、付款、Secrets、權限提升與不可逆 migration 不自動執行。
- 回覆使用繁體中文站長口吻；不宣稱尚未驗證的 Bug 已修復。

## Review Focus

- 重複排程/重送不得造成重複客服回覆。
- 惡意信件內容不得 prompt-inject operator 取得 secrets 或擴權。
- OpenAI/GitHub/Supabase 任一依賴失敗時工作必須可重試且不誤標完成。
- 使用者在 operator 處理途中追加訊息時，必須重新讀取最新 thread 再回覆。
- CI 失敗或修復未部署時，不得回覆「已修復」。

---

### Task 1: Operator data model and audit queue

**Files:**
- Create: `supabase/migrations/*_station_operator.sql`
- Test: SQL/RPC smoke checks

**Interfaces:**
- Produces: `station_operator_jobs`, `station_operator_audit`, claim/complete/fail RPCs.

- [ ] 建立 job/audit tables、狀態與唯一鍵避免重複處理。
- [ ] 建立 server/admin-only RPC 與 RLS。
- [ ] 驗證一般使用者無法讀寫 operator tables。
- [ ] Commit。

### Task 2: Server-only mailbox worker

**Files:**
- Create: `apps/web/lib/station-operator/*`
- Create: `apps/web/app/api/internal/station-operator/route.ts`
- Test: `apps/web/__tests__/station-operator-*.test.ts`

**Interfaces:**
- Consumes: operator RPCs and station mailbox data.
- Produces: authenticated `POST /api/internal/station-operator`.

- [ ] 寫 secret 驗證、idempotency、claim tests。
- [ ] 實作 server Supabase client 與 mailbox context loader。
- [ ] 實作一次只 claim 有限工作量的 worker。
- [ ] Typecheck/build。
- [ ] Commit。

### Task 3: OpenAI decision layer

**Files:**
- Create: `apps/web/lib/station-operator/openai.ts`
- Create: `apps/web/lib/station-operator/policy.ts`
- Test: policy/structured-output tests

**Interfaces:**
- Produces: structured decision `{kind, reply, actions, confidence, needsHuman}`.

- [ ] 定義 JSON schema 與允許 action 白名單。
- [ ] 將信件內容視為不可信資料，加入 prompt-injection 防護。
- [ ] 實作 OpenAI Responses API server call、timeout、錯誤處理。
- [ ] 對不可逆/高風險 action 強制 needsHuman。
- [ ] Commit。

### Task 4: Safe automatic replies

**Files:**
- Modify worker/policy files
- Test: reply idempotency and latest-thread tests

**Interfaces:**
- Consumes: decision output.
- Produces: one station-mail admin reply and audit event.

- [ ] 回覆前重新讀最新 thread。
- [ ] 用 unique job/message key 阻止重複回覆。
- [ ] 實作一般 FAQ/狀態說明直接回覆。
- [ ] 驗證錯誤時不標記完成。
- [ ] Commit。

### Task 5: Bug repair handoff

**Files:**
- Create: `.github/workflows/ai-repair.yml`
- Create: operator GitHub handoff module/API payload contract
- Test: payload validation

**Interfaces:**
- Produces: isolated `ai-repair/*` work item with source mailbox thread ID.

- [ ] 僅允許指定 repo 與隔離分支命名。
- [ ] 每個 Bug 最多兩次 repair attempts。
- [ ] CI/typecheck/build 必須成功才可標記 verified。
- [ ] 未驗證不得對使用者宣稱修好。
- [ ] Commit。

### Task 6: Scheduling and operations

**Files:**
- Create/modify deployment cron configuration and operator docs

**Interfaces:**
- Consumes: internal operator endpoint.
- Produces: recurring unattended execution.

- [ ] 設定合理排程頻率並用 secret 保護。
- [ ] 加入 timeout、batch limit、cost guard。
- [ ] 記錄每次 run 統計與錯誤。
- [ ] 驗證排程重疊時只有一個 worker claim 同一工作。
- [ ] Commit。

### Task 7: Admin visibility and kill switch

**Files:**
- Create/modify admin operator status UI
- Test: permissions and disabled-state behavior

**Interfaces:**
- Produces: operator enabled flag, recent actions, failed jobs, human-review queue.

- [ ] 顯示最近自動回覆/維修/失敗。
- [ ] 提供全域停用開關。
- [ ] 提供單一 thread 人工接管。
- [ ] Build/typecheck and final security review。
- [ ] Commit。
