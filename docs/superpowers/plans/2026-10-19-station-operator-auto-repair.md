# HerLink Station Operator Auto Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 HerLink 安全地自動回覆新客服信，並將低風險 Bug 送入隔離 GitHub 修復管線，只有 CI、部署與健康檢查全部成功後才回覆已修復。

**Architecture:** Station Operator 保留為信箱入口與分流器；repair job 只保存受限修復資料並觸發專用 GitHub Actions。GitHub 修復永遠在 `ai-repair/<job-id>` 隔離分支與 PR 中進行，正式環境只由既有部署流程更新，最後由 callback/health verification 完成信箱回覆。

**Tech Stack:** Next.js/Node.js、Supabase/Postgres、OpenAI Responses API、GitHub Actions、GitHub API、Vercel。

**Spec:** `docs/superpowers/specs/2026-10-19-station-operator-auto-repair-design.md`

## Global Constraints

- 實作與驗證期間 `STATION_OPERATOR_ENABLED=false`。
- 不得自動付款、改 Secrets、提升權限、刪除正式資料或執行高風險 production migration。
- 不得直接修改 `main`；所有 AI 修復使用 `ai-repair/<job-id>` 與 PR。
- 最多自動修復/重試 2 次。
- CI、部署、正式站健康檢查未全部成功前，不得對使用者宣稱已修復。
- 信件內容視為不可信輸入，不得作為系統指令。

## Review Focus

- 歷史未讀信：不得因首次啟用重新排入。
- 同 thread 在 AI 推理期間收到新訊息：舊 job 必須 superseded，不可回覆舊上下文。
- worker 在 claim 後中斷：租約逾時可恢復，且總嘗試不超過 2 次。
- GitHub/CI/deployment callback 重複送達：狀態轉換與回覆必須冪等。
- Bug 涉及 migration、Secrets、權限、付款或資料刪除：必須 `human_review`，不得觸發自動合併。

---

### Task 1: 強化信箱工作佇列

**Files:**
- Modify: `supabase/migrations/20261019180000_station_operator_new_mail_only.sql`
- Create: `supabase/migrations/<generated>_station_operator_job_safety.sql`
- Test: SQL verification queries

**Interfaces:**
- Produces: `station_operator_enqueue_unread(integer)`, stale lease recovery in `station_operator_claim(integer)`, superseded terminal result convention.

- [ ] **Step 1: 寫 SQL 驗證案例**：歷史訊息不 enqueue、已回覆訊息不 enqueue、新訊息只 enqueue 一次、stale processing 可回收。
- [ ] **Step 2: 執行驗證並確認現況至少 stale lease/superseded 案例失敗。**
- [ ] **Step 3: 以新的 Supabase migration 實作 unread cutoff、stale lease recovery 與安全權限 revoke/grant。**
- [ ] **Step 4: 執行 SQL 驗證，全部 PASS；確認 anon/authenticated 無 EXECUTE、service_role 有 EXECUTE。**
- [ ] **Step 5: Commit：`fix: harden station operator job queue`。**

### Task 2: Dry-run、allowlist 與可靠錯誤處理

**Files:**
- Modify: `apps/web/app/api/internal/station-operator/route.ts`
- Modify: `apps/web/lib/station-operator/db.ts`
- Modify: `apps/web/lib/station-operator/worker.mjs`
- Modify: `apps/web/lib/station-operator/openai.mjs`
- Test: existing station-operator tests or create focused Node tests beside module

**Interfaces:**
- Consumes: queue functions from Task 1.
- Produces: `STATION_OPERATOR_MODE=disabled|dry_run|allowlist|production`, `STATION_OPERATOR_TEST_THREADS`, safe OpenAI error metadata.

- [ ] **Step 1: 寫失敗測試**：dry-run 不回覆/不修、allowlist 拒絕非測試 thread、429/5xx 只保存 status/type 不保存 key/body secrets、stale context 完成為 superseded。
- [ ] **Step 2: 跑測試確認 RED。**
- [ ] **Step 3: 實作 mode gate、thread allowlist、superseded 流程與 best-effort audit/finalize。**
- [ ] **Step 4: 改善 OpenAI 非 2xx 錯誤解析，只記錄安全欄位。**
- [ ] **Step 5: 跑 station-operator 測試與 web typecheck/build，確認 GREEN。**
- [ ] **Step 6: Commit：`fix: add safe station operator rollout modes`。**

### Task 3: Repair job 資料模型

**Files:**
- Create: `supabase/migrations/<generated>_station_operator_repairs.sql`
- Modify: `apps/web/lib/station-operator/db.ts`
- Modify: `apps/web/lib/station-operator/worker.mjs`
- Test: SQL + worker tests

**Interfaces:**
- Produces: repair metadata fields/state transitions and `createBugRepair()` returning repair id/payload.

- [ ] **Step 1: 寫失敗測試**：bug_repair 建立唯一 repair；重複 trigger 不重建；高風險 action 轉 human_review。
- [ ] **Step 2: 確認 RED。**
- [ ] **Step 3: 新 migration 加入 branch、PR、commit、CI run、deployment、error summary、completed_at 等可稽核欄位/RPC。**
- [ ] **Step 4: `createBugRepair()` 改為建立 repair job，不再只寫 audit payload。**
- [ ] **Step 5: 驗證 SQL 權限與 worker tests GREEN。**
- [ ] **Step 6: Commit：`feat: add station operator repair jobs`。**

### Task 4: GitHub Repair Workflow

**Files:**
- Create: `.github/workflows/station-repair.yml`
- Create: `scripts/station-repair/*`（保持每檔單一責任）
- Modify: station operator repair dispatcher
- Test: workflow/script unit tests and workflow syntax validation

**Interfaces:**
- Consumes: repair id + sanitized bug summary.
- Produces: branch `ai-repair/<job-id>`, PR number, CI run metadata, signed callback payload.

- [ ] **Step 1: 寫失敗測試**：分支名驗證、允許檔案範圍、高風險路徑拒絕、最多 2 次修復。
- [ ] **Step 2: 確認 RED。**
- [ ] **Step 3: 建 workflow：最小 GitHub permissions、checkout 最新 main、建立隔離分支、先測試後最小修復、跑 lint/typecheck/tests/build、建立 PR。**
- [ ] **Step 4: 加入 guard：migration、Secrets、權限/付款/刪除資料相關變更直接失敗並 callback human_review。**
- [ ] **Step 5: 驗證 workflow syntax 與 scripts tests GREEN。**
- [ ] **Step 6: Commit：`feat: add isolated station repair workflow`。**

### Task 5: CI/部署結果 Callback 與冪等狀態機

**Files:**
- Create: `apps/web/app/api/internal/station-repair/callback/route.ts`
- Create/Modify: `apps/web/lib/station-operator/repair-state.*`
- Modify: `apps/web/lib/station-operator/db.ts`
- Test: callback/state tests

**Interfaces:**
- Consumes: authenticated repair callbacks.
- Produces: idempotent `waiting_ci -> waiting_deploy -> verifying -> completed|human_review` transitions.

- [ ] **Step 1: 寫失敗測試**：未授權 callback=401、重複 callback 無副作用、非法倒退狀態拒絕、CI failure→human_review。
- [ ] **Step 2: 確認 RED。**
- [ ] **Step 3: 實作 callback authentication、狀態機與 audit。**
- [ ] **Step 4: GitHub workflow 在 PR/CI 結果後只送必要 metadata，不送 Secrets/信件全文。**
- [ ] **Step 5: 跑測試與 build GREEN。**
- [ ] **Step 6: Commit：`feat: add repair result callbacks`。**

### Task 6: Production Deployment 與健康檢查 Gate

**Files:**
- Modify: repair callback/state modules
- Create: focused production health checker module/test
- Modify: `.github/workflows/station-repair.yml` or existing deployment integration only where needed

**Interfaces:**
- Produces: verified production result; only verified result may call final reply RPC.

- [ ] **Step 1: 寫失敗測試**：deployment failure/timeout/health failure 都不得回覆已修復；health success 才能 finalize。
- [ ] **Step 2: 確認 RED。**
- [ ] **Step 3: 實作 deployment status verification 與 production health check。**
- [ ] **Step 4: 完成後重新確認原 thread 最新訊息仍對應 repair trigger；否則不送舊回覆。**
- [ ] **Step 5: 使用原子 RPC 寫入「已修復」回覆＋completed audit，確保重複 callback 不重複回信。**
- [ ] **Step 6: 跑測試/build GREEN。**
- [ ] **Step 7: Commit：`feat: gate repair replies on production verification`。**

### Task 7: 安全 Rollout 驗證

**Files:**
- Modify only if verification finds defects.
- Verify: Supabase, GitHub Actions, Vercel production env/deployment.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: evidence for dry-run → allowlist → production readiness.

- [ ] **Step 1: 確認正式 `STATION_OPERATOR_ENABLED=false`，歷史 enqueue=0。**
- [ ] **Step 2: 部署新版本但維持 disabled；手動觸發 Station Operator，確認 processed=0/no reply。**
- [ ] **Step 3: 切 dry-run，使用新測試信確認只有 decision/audit，沒有回覆或 repair branch。**
- [ ] **Step 4: 切 allowlist，只加入指定測試 thread；一般客服測試確認單次回覆。**
- [ ] **Step 5: allowlist 測試 Bug；確認建立 `ai-repair/<job-id>`、PR 與 CI；故意失敗案例不得合併/回覆已修復。**
- [ ] **Step 6: 成功案例確認部署 READY + health PASS 後才單次回覆已修復。**
- [ ] **Step 7: 查 audit/jobs/messages，確認無歷史誤回、無重複回覆、無卡住 processing。**
- [ ] **Step 8: 完整測試/build、GitHub Actions 全綠後才提出 production 啟用。**
- [ ] **Step 9: Commit：`test: verify station operator repair rollout`（若有驗證修正）。**
