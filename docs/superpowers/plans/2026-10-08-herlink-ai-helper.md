# HerLink AI 小幫手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 Web 真人配對等待流程加入僅「孤星企鵝」可測試的 DeepSeek 官方 AI 陪聊，AI 不保存對話、不污染真人統計，且真人配對永遠優先且不受 AI 故障影響。

**Architecture:** 保留 `apps/web/app/waiting/page.tsx` 的既有 Supabase queue/Reatime 為真人配對唯一真相來源；新增伺服器端 `/api/ai-helper/chat` 作為 DeepSeek proxy，以及前端暫時記憶的 AI helper controller/UI。第一階段不新增永久 AI 訊息資料表；AI 對話只存在目前瀏覽器記憶體與單次 API request context，離開/轉真人即清除。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 7、Supabase JS、DeepSeek HTTP API、Node test runner/TypeScript typecheck。

**Spec:** `docs/superpowers/specs/2026-10-08-herlink-ai-helper-design.md`

## Global Constraints

- 第一階段只允許匿名顯示名稱精確等於 `孤星企鵝` 的測試身分啟用。
- AI 入口只在真人配對等待滿 20 秒且尚未配對成功時出現。
- DeepSeek API Key 只能存在伺服器端 `DEEPSEEK_API_KEY`。
- DeepSeek 只產生文字，不具有任何真人配對操作權限。
- AI 對話正文不得寫入 Supabase、localStorage、sessionStorage 或其他永久儲存。
- AI session 結束即清除前端對話 context。
- AI 不計入真人在線、queue、配對、訊息、彩蛋、等級、任務、圖鑑、Legendary、Eternal Bond 或匿名聯絡人。
- 真人候選 handoff 最多保留 10 秒；拒絕或逾時立即釋放。
- 連續拒絕真人 3 次後暫停真人搜尋，直到使用者主動重新開始。
- DeepSeek 失敗最多自動重試一次；失敗不得中斷或重建真人 queue。

## Review Focus

- 使用者在第 20 秒附近剛好配對成功：不得同時開 AI 與真人聊天室。
- DeepSeek request 尚未完成時真人出現：舊 AI response 不得在 handoff 後寫回畫面。
- 使用者快速重複送出訊息：避免重複 request、順序錯亂與無上限呼叫。
- 非「孤星企鵝」直接呼叫 AI API：伺服器必須拒絕，不能只靠前端隱藏。
- 頁面刷新/返回/取消配對：AI context 必須消失，真人 queue 行為維持既有語意。

---

### Task 1: AI helper 純邏輯與測試邊界

**Files:**
- Create: `apps/web/lib/ai-helper.ts`
- Create: `apps/web/lib/ai-helper.test.mjs`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `AI_HELPER_TRIGGER_MS = 20000`, `AI_HANDOFF_TIMEOUT_MS = 10000`, `AI_MAX_HANDOFF_REJECTIONS = 3`
- Produces: `isAiHelperTester(displayName: string | null | undefined): boolean`
- Produces: `shouldOfferAiHelper(input): boolean`
- Produces: `nextHandoffState(input): { rejectionCount: number; pauseMatching: boolean }`

- [ ] **Step 1:** 寫失敗測試，固定 20 秒觸發、只允許 `孤星企鵝`、未配對才可顯示、第三次拒絕後暫停。
- [ ] **Step 2:** 執行 `node --test apps/web/lib/ai-helper.test.mjs`，確認因模組/函式尚不存在而 FAIL。
- [ ] **Step 3:** 實作 `apps/web/lib/ai-helper.ts` 的常數與純函式，不加入 UI 或網路行為。
- [ ] **Step 4:** 再跑同一測試，預期 PASS；再跑 `npm --prefix apps/web run typecheck`。
- [ ] **Step 5:** Commit：`feat(web): add AI helper matching rules`。

### Task 2: DeepSeek 伺服器端 client 與 API 權限

**Files:**
- Create: `apps/web/lib/deepseek.ts`
- Create: `apps/web/lib/deepseek.test.mjs`
- Create: `apps/web/app/api/ai-helper/chat/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `isAiHelperTester(...)` from Task 1.
- Produces: `requestDeepSeekReply(messages, signal): Promise<string>`。
- Produces: `POST /api/ai-helper/chat`，body 為目前單次 AI session 的有限 message context，response 為 `{ reply: string }`。

- [ ] **Step 1:** 寫失敗測試：System Prompt 必須固定官方 AI 身分/繁中/不得偽裝真人/不得操作配對；輸入與歷史長度需有限制；缺 API key 與 provider 非 2xx 要回受控錯誤。
- [ ] **Step 2:** 跑 `node --test apps/web/lib/deepseek.test.mjs`，確認 FAIL。
- [ ] **Step 3:** 實作 `deepseek.ts`：伺服器端讀 `DEEPSEEK_API_KEY`，設定 timeout，限制輸入/輸出與 context，呼叫 DeepSeek chat endpoint；不得 export API key。
- [ ] **Step 4:** 實作 route：驗證 Supabase 使用者 session、載入 profile，伺服器端再次檢查名稱為 `孤星企鵝`；非測試者回 403。Request 只接受目前 AI context，不讀真人聊天室。
- [ ] **Step 5:** 在 `.env.example` 只加入 `DEEPSEEK_API_KEY=` 與 AI helper 非敏感設定名稱，不提交實際 secret。
- [ ] **Step 6:** 測試 DeepSeek timeout/provider error：route 回一般化錯誤，不洩漏 provider body、API key 或 stack。
- [ ] **Step 7:** 跑單元測試與 `npm --prefix apps/web run typecheck`，預期 PASS。
- [ ] **Step 8:** Commit：`feat(web): add protected DeepSeek AI helper API`。

### Task 3: 等待 20 秒後的小幫手入口與單次記憶 UI

**Files:**
- Create: `apps/web/components/AiHelperChat.tsx`
- Modify: `apps/web/app/waiting/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 1 trigger constants/rules。
- Consumes: `POST /api/ai-helper/chat` from Task 2。
- Produces: `AiHelperChat` component with in-memory `messages` only；`onClose`、`onRequestHuman`、handoff props。

- [ ] **Step 1:** 增加可測純狀態案例：19,999ms 不顯示、20,000ms 顯示；非測試帳永不顯示；已有真人 session 時永不顯示。
- [ ] **Step 2:** 修改 waiting page：從成功進入 queue/頁面可用時開始計時 20 秒；只對 `孤星企鵝` 顯示「先跟小幫手聊 / 繼續等真人」。
- [ ] **Step 3:** 建立 `AiHelperChat`：固定 `HerLink 小幫手` + `HerLink 官方 AI`；首次開場與快捷按鈕依 spec；messages 僅 React state，不寫 storage/Supabase。
- [ ] **Step 4:** 送出訊息時限制空白/過長內容、單一 request in-flight；request 完成前真人 handoff/離開時使用 AbortController 丟棄 response。
- [ ] **Step 5:** 離開小幫手、取消配對、返回首頁、component unmount 時清空 context。
- [ ] **Step 6:** 樣式沿用 HerLink 現有滿版/無多餘框層語言，不改一般使用者等待頁外觀。
- [ ] **Step 7:** 跑 `npm --prefix apps/web run typecheck` 與 AI helper tests，預期 PASS。
- [ ] **Step 8:** Commit：`feat(web): add tester-only AI helper waiting UI`。

### Task 4: 真人 Realtime handoff 與三次拒絕保護

**Files:**
- Modify: `apps/web/app/waiting/page.tsx`
- Modify: `apps/web/components/AiHelperChat.tsx`
- Modify: `apps/web/lib/ai-helper.ts`
- Modify: `apps/web/lib/ai-helper.test.mjs`

**Interfaces:**
- Consumes: 既有 `random_match_queue` Realtime UPDATE 與 `matched_session_id`。
- Produces: AI chat 中真人候選 handoff 狀態、10 秒 timeout、拒絕計數與暫停/恢復真人搜尋。

- [ ] **Step 1:** 寫失敗測試：真人 matched 事件優先於 AI；接受立即結束 AI；拒絕/10 秒逾時釋放候選；第三次拒絕進 pause；重新開始歸零。
- [ ] **Step 2:** 調整 Realtime handler：未開 AI 時維持既有自動 `router.replace`；AI 開啟時改顯示「有人來了」handoff UI，不允許 DeepSeek 文字觸發此狀態。
- [ ] **Step 3:** 接受 handoff：abort AI request、清 context、鎖定/確認真人 session 後導向 `/session/{id}`。
- [ ] **Step 4:** 拒絕或 10 秒逾時：呼叫既有/新增的安全 queue release/重新排隊介面，確保對方不被卡住；不得刪除 AI context。
- [ ] **Step 5:** 第三次拒絕：暫停真人搜尋並顯示「重新開始找人」；按下後 rejection count 歸零並恢復 queue。
- [ ] **Step 6:** 驗證第 20 秒附近真人先到、AI request 中真人到、快速重複 matched event 都只進一個真人 session。
- [ ] **Step 7:** 跑 tests + typecheck，預期 PASS。
- [ ] **Step 8:** Commit：`feat(web): hand off AI waiting chat to real matches`。

### Task 5: 故障降級、匿名事件與真人統計隔離驗證

**Files:**
- Create: `apps/web/lib/ai-helper-events.ts`
- Create: `apps/web/lib/ai-helper-events.test.mjs`
- Modify: `apps/web/components/AiHelperChat.tsx`
- Modify: `apps/web/app/api/ai-helper/chat/route.ts`
- Modify only if required after audit: existing stats/achievement query files that accidentally consume AI events.

**Interfaces:**
- Produces: content-free event names such as `ai_helper_offered`, `ai_helper_started`, `ai_helper_handoff_shown`, `ai_helper_handoff_accepted`, `ai_helper_handoff_rejected`, `ai_helper_handoff_timeout`, `ai_helper_provider_error`。
- No event payload may contain user/AI message text。

- [ ] **Step 1:** 寫失敗測試：事件 serializer 拒絕 `content/message/reply/prompt` 欄位，只允許 session timing/count/status 類 metadata。
- [ ] **Step 2:** 實作 DeepSeek request 第一次失敗後最多重試一次；第二次失敗進「小幫手暫時去休息了」狀態，真人 queue 保持原狀。
- [ ] **Step 3:** 實作 content-free AI event helper；若目前沒有合適安全的事件儲存表，第一階段只保留伺服器 aggregate/log 計數介面，不為了 analytics 建 AI 對話表。
- [ ] **Step 4:** 全 repo 搜尋真人統計/彩蛋/achievement/message count 的來源，確認 AI helper 沒有寫入它們使用的 `messages`/session/contacts 資料來源；若有交集，加明確 `human` filter 或保持 AI 完全不入庫。
- [ ] **Step 5:** 驗證 AI session 結束後 Supabase 不存在 AI message body；刷新頁面後舊 AI 對話不可恢復。
- [ ] **Step 6:** 跑 AI helper tests、`npm --prefix apps/web run typecheck`、`npm --prefix apps/web run build`。
- [ ] **Step 7:** Commit：`test(web): verify AI helper privacy and graceful fallback`。

### Task 6: 測試帳驗收與發布護欄

**Files:**
- Modify as needed: `apps/web/app/waiting/page.tsx`
- Modify as needed: `apps/web/app/api/ai-helper/chat/route.ts`
- Update: `docs/superpowers/specs/2026-10-08-herlink-ai-helper-design.md` only if implementation uncovers an approved spec clarification.

**Interfaces:**
- Produces: first-stage feature ready for isolated `孤星企鵝` testing; does not enable general users.

- [ ] **Step 1:** 以「孤星企鵝」驗收：等待 20 秒 → AI 入口 → DeepSeek 對話 → 背景真人 queue 保持。
- [ ] **Step 2:** 驗收真人 handoff：接受、拒絕、10 秒逾時、連拒 3 次、重新開始找人。
- [ ] **Step 3:** 驗收故障：無/錯誤 API key、timeout、429/5xx；畫面只顯示友善降級，真人 queue 不受影響。
- [ ] **Step 4:** 使用另一個一般匿名名稱驗收：等待超過 20 秒仍看不到 AI 入口，直接呼叫 API 得 403。
- [ ] **Step 5:** 安全檢查：repository、client bundle、Network response 均不得出現 `DEEPSEEK_API_KEY` 值。
- [ ] **Step 6:** 最終執行 `node --test apps/web/lib/*.test.mjs`、`npm --prefix apps/web run typecheck`、`npm --prefix apps/web run build`，全部 PASS 才可進部署流程。
- [ ] **Step 7:** 建立 PR/測試分支驗證；不得因本計畫自動全面開放一般使用者。
