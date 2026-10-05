# Phase 1 clean branch ledger

- BASE: `f63b5628215584d74978b464c05bb5dc1b98e1d7`
- Branch: `test/phase1-identity-preservation-clean`
- Ruling: PR CI 不可碰正式 Supabase；完整資料不變測試只允許專用 `PHASE1_TEST_SUPABASE_*` secrets 手動執行。
- Ruling: `work/account-binding-phase1-test.mjs` 已在 BASE，沿用作完整整合測試，不重寫正式資料。
- Added: isolated `apps/web/lib/account-binding.ts` helper.
- Added: helper guard contract test.
- Added: Phase 1 GitHub Actions workflow.
- Safety: no merge, no deployment, no production 孤星企鵝 mutation.
