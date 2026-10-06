# 匿名身分自助恢復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 HerLink 使用者可用永久一次性恢復碼，在新瀏覽器自行接管原匿名身分、聊天室與既有資料，並使舊裝置立即失效，同時保留管理員人工恢復。

**Architecture:** 將永久身分憑證與現有 30 分鐘 `anonymous_session_recovery_requests` 完全分離。永久 token 僅保存雜湊；預覽與正式接管均由 service-role Edge Function 處理，正式接管的資料變更由單一資料庫 transaction/RPC 完成。匿名身分增加 credential generation，所有可寫操作必須驗證 generation，接管時提升 generation 以撤銷舊裝置。

**Tech Stack:** Supabase Postgres/RLS/RPC、Supabase Edge Functions (Deno/TypeScript)、Next.js Web (`apps/web`)、TypeScript、現有 GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-06-self-service-anonymous-recovery-design.md`

## Global Constraints

- 新裝置接管成功後，舊裝置立即失效。
- 永久恢復碼只有目前有效的一組；成功使用一次後立即失效並輪替新碼。
- 資料庫、一般 log、分析事件不得保存恢復碼明碼。
- 不允許只靠匿名名稱恢復。
- 現有 `anonymous_session_recovery_requests`、管理員 A/B 人工恢復與 30 分鐘重新啟用流程保留。
- 自助恢復不合併目前臨時 profile 與舊 profile 的聊天資料。
- 任何接管 transaction 失敗必須完整 rollback。
- 正式開放前先以管理員測試身分驗證，不先改寫既有聊天室/訊息資料。

## Review Focus

- 同一恢復碼被兩個請求同時使用：只能一個成功，另一個收到統一失敗。
- 網路中斷後重送完成請求：不得再次接管或再次輪替 token。
- 使用者目前的新 profile 已有聊天室：不得刪除或合併其資料。
- 舊裝置在接管完成後持續發送寫入：伺服器必須拒絕舊 generation。
- 人工恢復完成後舊永久 token：必須同步撤銷並輪替，不能留下可再次接管的憑證。

---

### Task 1: 永久恢復憑證與匿名 credential generation 資料模型

**Files:**
- Create: `supabase/migrations/20261006_self_service_anonymous_recovery.sql`
- Test: migration 內 SQL invariants，並由既有 Supabase migration 驗證流程執行

**Interfaces:**
- Produces: `anonymous_identity_recovery_tokens`, `anonymous_identity_recovery_audit`, profile/session credential generation 欄位，以及 service-role 專用 RPC 所需資料結構。

- [ ] **Step 1: 先寫資料庫驗證 SQL**：驗證同一 profile 只能有一筆有效 token、`token_hash` 唯一、client role 無法直接讀寫 token/audit、generation 有明確初始值。
- [ ] **Step 2: 執行驗證並確認在 migration 前失敗**。
- [ ] **Step 3: 建立 migration**：新增 token 表（`id`, `profile_id`, `token_hash`, `created_at`, `used_at`, `revoked_at`, `replaced_by`）、audit 表；增加匿名 credential generation；建立必要 unique/partial indexes、FK 與 RLS/revoke。
- [ ] **Step 4: 加入 transaction RPC 介面**：例如 `complete_anonymous_identity_recovery(source_profile_id uuid, target_profile_id uuid, token_id uuid, new_token_hash text, request_id uuid)`；使用 row lock/條件更新保證 token 只能消耗一次，提升 target generation、標記舊 token、建立新 token 與 audit 必須同 transaction。
- [ ] **Step 5: 執行 migration 驗證**，確認重複有效 token、直接 client 存取、重複消耗均被拒絕。
- [ ] **Step 6: Commit**：`feat(db): add anonymous identity recovery tokens`。

### Task 2: 恢復碼產生、雜湊與限速共用模組

**Files:**
- Create: `supabase/functions/_shared/anonymous-recovery.ts`
- Test: `work/anonymous-recovery-crypto-test.mjs`

**Interfaces:**
- Produces: `normalizeRecoveryCode(code)`, `hashRecoveryCode(code)`, `generateRecoveryCode()`, `checkRecoveryRateLimit(...)`。

- [ ] **Step 1: 寫失敗測試**：正規化大小寫/空白；生成碼符合產品格式且有足夠熵；同碼 hash 穩定；log helper 不輸出明碼；IP + source profile 超限會拒絕。
- [ ] **Step 2: 執行測試確認失敗**。
- [ ] **Step 3: 實作最小共用模組**；若可靠限速無法支撐 8 碼空間，依 spec 提高碼長，不降低限速要求。
- [ ] **Step 4: 執行測試確認通過**。
- [ ] **Step 5: Commit**：`feat(recovery): add secure recovery token helpers`。

### Task 3: 自助恢復預覽 API

**Files:**
- Create: `supabase/functions/anonymous-self-recovery/index.ts`
- Test: `work/anonymous-self-recovery-preview-test.mjs`

**Interfaces:**
- Consumes: Task 1 token/generation schema；Task 2 hash/rate-limit helpers。
- Produces: `POST anonymous-self-recovery { action: "preview", recoveryCode, sourceProfileId, sourceGeneration }` → `{ ok, recoveryAttemptId, displayName, chatCount }`，不回傳聊天室訊息或對方敏感資料。

- [ ] **Step 1: 寫失敗測試**：有效碼只回最少確認資訊；不存在/used/revoked token 使用同一錯誤；錯誤嘗試達門檻被限速；source credential 不合法被拒絕。
- [ ] **Step 2: 執行確認失敗**。
- [ ] **Step 3: 實作 preview**：service-role 查 token hash，驗證 source credential，建立短效 `recoveryAttemptId`/server-side attempt，不把明碼寫 log。
- [ ] **Step 4: 執行測試確認通過**。
- [ ] **Step 5: Commit**：`feat(recovery): add self recovery preview API`。

### Task 4: 原子接管與 token 輪替 API

**Files:**
- Modify: `supabase/functions/anonymous-self-recovery/index.ts`
- Modify: `supabase/migrations/20261006_self_service_anonymous_recovery.sql`（僅在 Task 1 RPC 介面需補強時）
- Test: `work/anonymous-self-recovery-complete-test.mjs`

**Interfaces:**
- Produces: `POST anonymous-self-recovery { action: "complete", recoveryAttemptId, sourceProfileId, sourceGeneration }` → `{ ok, profileId, generation, newRecoveryCode }`。

- [ ] **Step 1: 寫失敗測試**：原名稱/聊天室/訊息/聯絡人/未讀/彩蛋資料不變；source profile 有資料時不刪除；舊 token 失效；新 token 建立；target generation +1；兩個 concurrent complete 只有一個成功；transaction 中途故障完全 rollback；重送不造成第二次輪替。
- [ ] **Step 2: 執行確認失敗**。
- [ ] **Step 3: 實作 complete**：產生新碼與 hash，呼叫 Task 1 transaction RPC，明碼只在成功 response 出現一次。
- [ ] **Step 4: 執行測試確認通過**。
- [ ] **Step 5: Commit**：`feat(recovery): complete atomic anonymous identity takeover`。

### Task 5: 全域匿名寫入 generation 驗證

**Files:**
- Modify: 現有匿名聊天/聯絡人/恢復/其他可寫 RPC 與 Edge Function 的共用授權層；實作前以 code search 列出所有依匿名 UUID 授權的 mutation endpoint，逐一納入。
- Create/Test: `work/anonymous-generation-enforcement-test.mjs`

**Interfaces:**
- Consumes: Task 1 generation。
- Produces: 所有匿名 mutation 必須同時驗證 profile UUID + current generation。

- [ ] **Step 1: 建立 mutation inventory**，明列發訊息、配對、離開、聯絡人、未讀/狀態更新、恢復相關寫入，不漏掉只驗 UUID 的路徑。
- [ ] **Step 2: 寫失敗測試**：接管前 credential 可寫；generation 提升後舊 credential 對每一類 mutation 都失敗；新 credential 正常。
- [ ] **Step 3: 執行確認失敗**。
- [ ] **Step 4: 在共用授權層/各 RPC 最小修改加入 generation 驗證**，避免只靠 localStorage UUID。
- [ ] **Step 5: 跑完整 mutation 測試與既有聊天 regression tests**。
- [ ] **Step 6: Commit**：`feat(auth): revoke stale anonymous device credentials`。

### Task 6: 現有人工恢復與永久 token 相容

**Files:**
- Modify: 現有管理員恢復 A/B 方實作與其資料庫/RPC 路徑
- Modify: `supabase/functions/admin-reactivate-session-recovery/*`（若該 function 原始碼在實際部署來源；先確認 repository/deployment source）
- Test: `work/admin-recovery-token-rotation-test.mjs`

**Interfaces:**
- Produces: 人工恢復成功後提升 generation、撤銷舊永久 token、產生新 token；`anonymous_session_recovery_requests` 仍維持 30 分鐘人工流程。

- [ ] **Step 1: 寫失敗測試**：人工恢復 A/B 正常；過期申請重新啟用正常；人工恢復後舊永久 token 無效；不把舊 30 分鐘 code 自動升級成永久 token。
- [ ] **Step 2: 執行確認失敗**。
- [ ] **Step 3: 將人工恢復成功路徑接到相同 credential/token rotation primitive**。
- [ ] **Step 4: 跑管理後台與 account-binding/recovery regression tests**。
- [ ] **Step 5: Commit**：`fix(recovery): rotate identity token after admin recovery`。

### Task 7: Web 自助恢復流程

**Files:**
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/lib/anonymous-self-recovery.ts`（若現有 web API helper 慣例有更合適位置則沿用）
- Test: Web 現有測試位置；若無 UI harness，加入可執行的 helper/state tests 至 `work/anonymous-self-recovery-web-test.mjs`

**Interfaces:**
- Consumes: Task 3/4 API。
- Produces: 「無法進入原本聊天室？」→「我有恢復碼」與「恢復碼遺失」兩條路徑。

- [ ] **Step 1: 寫失敗測試**：輸入碼→preview→顯示匿名名稱/聊天室數→確認→complete→保存新 profile/generation→重新載入；失敗不清除目前身分；成功顯示新碼與「舊碼失效、舊裝置已登出」。
- [ ] **Step 2: 執行確認失敗**。
- [ ] **Step 3: 實作 API helper 與 UI state**，不直接從前端更新 profile/session/message ownership。
- [ ] **Step 4: 保留「恢復碼遺失」既有人工申請流程與文案。
- [ ] **Step 5: 跑 Web tests/build/typecheck**。
- [ ] **Step 6: Commit**：`feat(web): add anonymous self service recovery flow`。

### Task 8: 安全、整合與正式站前驗收

**Files:**
- Modify/Create: `work/anonymous-self-recovery-e2e-test.mjs`
- Modify: GitHub Actions 測試設定（只有現有 workflow 未涵蓋新增測試時才改）

**Interfaces:**
- Consumes: Tasks 1–7。
- Produces: 可部署、可回滾且經完整驗收的自助恢復功能。

- [ ] **Step 1: 跑安全測試**：暴力錯碼限速、token enumeration 統一錯誤、明碼 log 掃描、client 直接表存取拒絕、concurrency replay。
- [ ] **Step 2: 跑資料完整性測試**：恢復前後 session/message IDs、聯絡人、未讀、彩蛋/成就不變；臨時 source profile 有資料時保持不變。
- [ ] **Step 3: 以管理員測試身分完成實際流程**：產碼 → 新瀏覽器 → preview → complete → 原聊天室可見 → 舊裝置 mutation 被拒 → 新碼可用、舊碼不可用。
- [ ] **Step 4: 驗證人工恢復 regression**：A/B 恢復與過期重新啟用仍正常。
- [ ] **Step 5: 跑完整 GitHub Actions；不得以 EAS 代替。
- [ ] **Step 6: 分階段部署**：先 migration + function，再 Web UI；若 feature flag/管理員 gate 已有慣例，先只開管理員測試身分，驗收後才開一般使用者。
- [ ] **Step 7: Commit**：`test(recovery): verify self service recovery end to end`。

## 完成定義

1. 有有效永久恢復碼的新瀏覽器能在不經管理員操作下接回原身分。
2. 舊裝置立即失去寫入權限，不是只清除 UI/localStorage。
3. 原聊天室、訊息、聯絡人、未讀、彩蛋/成就資料沒有被搬動或批次重寫。
4. 舊碼不可重放，新碼只在成功時顯示一次，DB/log 不保存明碼。
5. 暴力嘗試、token 探測、並行重放受到防護。
6. 人工恢復仍可用，且人工恢復也會撤銷舊永久 token。
7. GitHub Actions 與自助恢復 E2E 全部通過後才允許一般使用者使用。