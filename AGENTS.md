# HerLink 長期開發工作區

這個儲存庫是 HerLink 的唯一開發來源。任何新工作都必須先閱讀
[`docs/HERLINK_WORKSPACE.md`](docs/HERLINK_WORKSPACE.md)，再改動程式。

## 不可違反的規則

- 產品目前以「匿名聊天室」為核心；不得自行復活舊交友、喜歡、配對探索流程。
- 先改後簡短回報；但涉及資料庫結構、帳號／身份恢復、權限、部署或刪除資料時，先做範圍檢查並明確回報影響。
- 手機 App 的正式建置只走 GitHub Actions，**不可使用 EAS Build**。`eas.json` 只視為歷史相容設定。
- Web 由 Vercel 的 GitHub 連線部署；不直接在正式環境手改檔案。
- Supabase 結構變更一律新增可重跑 migration，不能改寫或刪除既有 migration，不能以 reset／drop 當修法。
- 不提交 `.env`、金鑰、token、APK、憑證或使用者聊天內容。Service role key 只可在 Supabase Edge Function 或受保護的伺服端環境使用。
- 任何前端管理功能都必須由 RLS 或受保護 RPC／Edge Function 再驗證管理員身分；不可只靠 UI 隱藏。
- 每次改 Web 至少執行 `npm ci --prefix apps/web`、`npm run typecheck --prefix apps/web` 與 `npm run build --prefix apps/web`；有資料庫變更時一併做對應的只讀／正反向驗證。

## 技術邊界

- Mobile：Expo 57、React Native、expo-router（`app/`）。
- Web：Next.js（`apps/web/`），由根目錄 `vercel.json` 指向該子專案。
- Backend：Supabase（`supabase/migrations/`、`supabase/functions/`）。
- GitHub 遠端：`https://github.com/wer930821/HerLink.git`；正式分支為 `master`。

Expo 的 API 有重大版本差異；改動 Expo／React Native 前，先查對應版本的官方文件。
