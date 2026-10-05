# Phase 1 身分不變測試

此分支只用於 Phase 1 帳號綁定驗證，不合併、不部署。

- `account-binding.ts` 只允許匿名名稱「孤星企鵝」進入 helper。
- PR CI 只執行 helper contract、TypeScript typecheck 與 web build，不連線正式 Supabase。
- 完整 `work/account-binding-phase1-test.mjs` 只允許 `workflow_dispatch` 手動執行，且只讀取 `PHASE1_TEST_SUPABASE_*` 專用測試 secrets。
- 不使用正式 Supabase secrets，不修改孤星企鵝正式 profile、聊天室、訊息或恢復資料。
- 完整測試驗證 UUID、聊天室、訊息、匿名名稱、8 碼恢復資料、重新登入 UUID 與第三方 RLS。
