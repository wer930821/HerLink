# Permanent Anonymous Recovery Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓仍持有 HerLink 匿名身分的使用者建立永久 8 碼恢復碼，遺失瀏覽器身分後可安全自助接回原匿名身分、聯絡人與聊天室，並保留既有人工恢復。

**Architecture:** 新增獨立永久恢復憑證資料表，不改變 `anonymous_session_recovery_requests` 的 30 分鐘人工恢復語意。恢復碼只在產生/輪替/成功接管後回傳一次明碼，資料庫只存 HMAC/hash；claim 必須原子化完成憑證驗證、舊 session 撤銷、身分接管、舊碼失效與新碼輪替。

**Tech Stack:** Next.js/React、Supabase/PostgreSQL、Supabase Auth/Edge Functions（依 repo 現有模式）、Node tests/GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-06-self-service-anonymous-recovery-design.md`

## Global Constraints

- 正式分支是 `main`；所有實作先在獨立 feature branch，測試通過後才合併。
- 永久恢復碼固定 8 碼大寫英數；資料庫、API logs、analytics 不得保存明碼。
- 每個匿名身分同時只能有 1 組 active 永久恢復碼。
- 永久碼未使用前不過期；使用成功或主動輪替後立即失效。
- 成功 claim 後舊裝置立即失效，並自動產生新永久碼給新裝置保存。
- 不允許只靠匿名名稱自助接管。
- 暫時新 profile 的聊天資料不得與舊 profile 合併。
- 既有 30 分鐘管理員人工恢復流程必須保持可用。
- Live Supabase migration/functions deployment 與 Production promotion 在完成分支驗證後另行執行，不在未驗證狀態直接套正式資料庫。

## Review Focus

- 同一恢復碼被兩台裝置同時 claim：只能一台成功，另一台必須得到已使用/失效結果。
- claim 中途任何資料更新失敗：整筆 transaction rollback，原身分與原有效碼仍可使用。
- 使用者已在新瀏覽器建立暫時匿名 profile：不得把暫時 profile 的聊天室混進舊 profile。
- 舊裝置在 claim 完成後再次呼叫受保護 API：必須被判定 session 已撤銷。
- 猜碼/暴力嘗試：preview 與 claim 都需 rate limit，且錯誤回應不得洩漏是否存在特定匿名名稱。

---

### Task 1: Permanent recovery credential schema

**Files:**
- Create: `supabase/migrations/<timestamp>_anonymous_recovery_credentials.sql`
- Test: repo 現有 migration/schema 驗證位置；若無則新增最小 SQL contract test。

**Interfaces:**
- Produces: `anonymous_recovery_credentials`，欄位 `id`, `anonymous_identity_id`, `code_hash`, `code_hint`, `version`, `created_at`, `rotated_at`, `used_at`, `revoked_at`, `last_used_at`。
- Produces: partial unique constraint，保證每個 `anonymous_identity_id` 最多一筆 `used_at IS NULL AND revoked_at IS NULL`。

- [ ] Step 1: 寫失敗測試，固定欄位、索引、active 唯一限制，並確認 schema 不存在 plaintext `recovery_code` 欄位。
- [ ] Step 2: 執行 schema test，確認 FAIL。
- [ ] Step 3: 建立 migration；外鍵指向 repo 實際匿名身分主鍵，沿用既有 RLS/privilege 模式，禁止 client 直接讀 `code_hash`。
- [ ] Step 4: 重跑 schema test，確認 PASS。
- [ ] Step 5: commit `feat(db): add permanent anonymous recovery credentials`。

### Task 2: Recovery-code crypto and rate-limit primitives

**Files:**
- Create/Modify: 依 repo 現有 server/Supabase shared helper 位置新增 `anonymous-recovery` helper。
- Test: 對應 unit test。

**Interfaces:**
- Produces: `generateRecoveryCode(): string`，固定 8 碼大寫英數且使用 cryptographic RNG。
- Produces: `hashRecoveryCode(code: string): string` / `verifyRecoveryCode(code, hash): boolean`，使用 server secret/HMAC 或 repo 既有安全雜湊慣例。
- Produces: `recoveryCodeHint(code): string` → `••••••BC`。

- [ ] Step 1: 寫 FAIL tests：長度/字元集、連續產生不重複、hash 不含明碼、正確碼驗證成功、錯碼失敗、hint 只露最後兩碼。
- [ ] Step 2: 執行 tests，確認 FAIL。
- [ ] Step 3: 實作最小 helper，任何 log 不得輸出 raw code。
- [ ] Step 4: 加 preview/claim rate-limit contract test，固定超限回應為 429。
- [ ] Step 5: tests PASS 後 commit `feat(recovery): add secure recovery code primitives`。

### Task 3: Generate/status/rotate APIs

**Files:**
- Create/Modify: repo 現有 API/Edge Function pattern 下的 permanent recovery endpoints。
- Test: API tests。

**Interfaces:**
- Produces: `POST .../code`：僅有效目前匿名 session 可建立；回傳 `{ recoveryCode, hint, createdAt }`。
- Produces: `GET .../code`：只回 `{ hasRecoveryCode, hint, createdAt }`，永不回原明碼。
- Produces: `POST .../code/rotate`：原子 revoke 舊碼並建立新碼，回傳新明碼一次。

- [ ] Step 1: 寫 FAIL tests：未登入 401；首次建立成功；第二次不得產生第二個 active code；status 不含明碼。
- [ ] Step 2: 寫 FAIL tests：rotate 成功後舊 hash revoked、新 code active；rotate 失敗時舊 code 保持 active。
- [ ] Step 3: 實作 endpoints/RPC transaction。
- [ ] Step 4: 執行 API + schema tests，確認 PASS。
- [ ] Step 5: commit `feat(recovery): generate and rotate permanent codes`。

### Task 4: Preview and atomic claim

**Files:**
- Create/Modify: permanent recovery preview/claim API/RPC。
- Test: concurrency/transaction tests。

**Interfaces:**
- Produces: `POST .../preview`：輸入 `{ recoveryCode }`，成功只回必要確認資訊 `{ displayName }`。
- Produces: `POST .../claim`：輸入 recovery code + current authenticated temporary anonymous session context；成功回 `{ success, displayName, newRecoveryCode }`。

- [ ] Step 1: 寫 FAIL tests：正確碼 preview 顯示名稱；錯誤/失效碼使用一致安全錯誤；不得回 UUID、訊息或聯絡人內容。
- [ ] Step 2: 寫 FAIL concurrency test：同碼兩個 claim 同時執行只能一個成功。
- [ ] Step 3: 寫 FAIL rollback test：模擬接管中途失敗，舊 session 與舊碼保持可用。
- [ ] Step 4: 實作 transaction：row lock credential → verify active hash → validate current session → transfer/reattach existing anonymous identity according to current data model → revoke old sessions → mark code used → create new credential → commit。
- [ ] Step 5: 加測試確認暫時 profile 聊天資料不合併，舊聊天室/聯絡人完整保留。
- [ ] Step 6: 全部 PASS 後 commit `feat(recovery): add atomic anonymous identity claim`。

### Task 5: Global old-device revocation enforcement

**Files:**
- Modify: repo 現有 anonymous session validation/auth guard。
- Test: auth/session tests。

**Interfaces:**
- Consumes: Task 4 claim 產生的 revocation/session generation 狀態。
- Produces: 所有需要匿名身分的寫入 API 都拒絕舊 generation/session。

- [ ] Step 1: 寫 FAIL test：claim 後舊裝置讀/寫受保護操作被拒，新裝置成功。
- [ ] Step 2: 檢查所有主要匿名寫入入口使用共同 guard，避免只在首頁 UI 擋住。
- [ ] Step 3: 實作最小 generation/revocation enforcement。
- [ ] Step 4: tests PASS 後 commit `fix(auth): revoke old anonymous sessions after recovery`。

### Task 6: Web identity-and-recovery management UI

**Files:**
- Modify: `apps/web/app/page.tsx` 或目前 main 實際首頁入口元件。
- Create/Modify: `apps/web/components/*recovery*` focused components。
- Test: `apps/web/__tests__/*recovery*`。

**Interfaces:**
- Consumes: Task 3 status/generate/rotate APIs。
- Produces: 正常持有匿名身分時的「身分與恢復」入口。

- [ ] Step 1: 寫 FAIL UI test：無永久碼顯示「產生恢復碼」；有碼只顯示 hint 與「更換恢復碼」。
- [ ] Step 2: 寫 FAIL UI test：建立成功完整碼只在當次結果顯示，文案包含「關閉後我們不會再次顯示完整恢復碼」。
- [ ] Step 3: 實作 generate/status UI 與複製按鈕。
- [ ] Step 4: 寫 FAIL rotate confirmation test：「更換後，舊恢復碼會立即失效」。
- [ ] Step 5: 實作 rotate UI；成功顯示新碼一次。
- [ ] Step 6: tests PASS 後 commit `feat(web): add permanent recovery code management`。

### Task 7: Web self-service recovery flow + manual fallback

**Files:**
- Modify: 現有 `RecoveryEntryOptions`/恢復彈窗相關元件。
- Test: recovery entry/integration tests。

**Interfaces:**
- Consumes: Task 4 preview/claim。
- Preserves: 既有 `requestRandomIdentityRecovery(recoveryName)` 人工恢復流程。

- [ ] Step 1: 寫 FAIL test：「我有恢復碼」開啟 8 碼輸入，而非顯示尚未完成提示。
- [ ] Step 2: 寫 FAIL test：preview 後顯示「找到『{displayName}』」與舊裝置失效警告。
- [ ] Step 3: 寫 FAIL test：claim 成功顯示新永久碼，並重新載入目前匿名身分/聊天室。
- [ ] Step 4: 實作 self-service UI。
- [ ] Step 5: 回歸測試「我沒有恢復碼／需要站長協助」仍可建立既有 8 碼人工申請。
- [ ] Step 6: tests PASS 後 commit `feat(web): enable self-service anonymous recovery`。

### Task 8: Security, regression, deployment verification

**Files:**
- Modify: `.github/workflows/*` only if existing CI does not run new tests。
- No production data mutation in this task until all pre-production checks pass。

**Interfaces:**
- Consumes: Tasks 1-7。
- Produces: merge-ready feature branch and explicit deployment checklist。

- [ ] Step 1: 跑全部 recovery tests、web build/typecheck、既有人工 recovery regression tests。
- [ ] Step 2: 搜尋 repo/fixtures/log statements，確認沒有 raw permanent recovery code 被寫入 DB/log/analytics。
- [ ] Step 3: 在非 Production 環境跑 E2E：建立碼 → 新瀏覽器 preview → claim → 舊裝置失效 → 新碼可再次恢復。
- [ ] Step 4: 驗證人工恢復仍可建立、重新啟用與 A/B 接回。
- [ ] Step 5: 開 PR 到 `main`，等待 GitHub Actions/Vercel Preview READY，檢查 diff 僅包含本功能。
- [ ] Step 6: 合併後依序套用 Production migration/functions，再驗證正式網址指向新 `main` deployment；若任一步失敗立即停止，不做部分資料接管。
