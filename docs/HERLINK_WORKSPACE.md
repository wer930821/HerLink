# HerLink 長期開發交接

最後整理：2026-10-04（Asia/Taipei）  
來源：`master` @ `97e8fe9`

## 專案定位

HerLink 現在是女性使用者的匿名聊天室服務。保留匿名名稱、等待／配對、聊天室、身份恢復與安全管理；不再把舊交友、按喜歡或個人探索當成主要功能。所有改動以「不遺失既有聊天室與匿名身份」為最高原則。

## 儲存庫與服務

| 項目 | 現況／規則 |
| --- | --- |
| GitHub | `wer930821/HerLink`，正式分支 `master` |
| Web | `apps/web/` 的 Next.js 16；Vercel 由 GitHub 連線部署，根目錄設定見 `vercel.json` |
| Android App | 根目錄 Expo／React Native；正式 APK 只由 GitHub Actions 產生，不用 EAS Build |
| Backend | Supabase：migration 在 `supabase/migrations/`，Edge Functions 在 `supabase/functions/` |
| 管理端 | 行動端 `app/admin.tsx`；Web 管理面仍位於 `apps/web/app/admin/page.tsx`，修改或下架前需確認現場營運是否仍在使用 |

## 機密與環境變數

不可把實際值寫進文件、commit、issue、聊天紀錄或螢幕截圖。前端只使用匿名金鑰；`SUPABASE_SERVICE_ROLE_KEY` 只允許 Edge Function／受保護伺服端使用。

| 用途 | 變數名稱 |
| --- | --- |
| Mobile Supabase | `EXPO_PUBLIC_SUPABASE_URL`、`EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Web Supabase | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`（Web 也相容讀取 Expo 同名變數） |
| 彩蛋測試帳號 | `NEXT_PUBLIC_EASTER_EGG_TEST_USER_ID` |
| Edge Functions | `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`，及各功能需要的服務端 secret |

## 部署流程

### Web

1. 先在本機執行：
   `npm ci --prefix apps/web`
   `npm run typecheck --prefix apps/web`
   `npm run build --prefix apps/web`
2. 確認沒有把環境變數 fallback、RLS 或身份恢復流程改壞。
3. 提交至 `master`，由 Vercel 的 GitHub 連線部署。
4. 部署後實測首頁、等待區、既有聊天室、重新整理後的身份保留與管理員權限。

### Android

1. 先確認 Expo SDK 57 對應的官方文件與設定。
2. 以 GitHub Actions 產生 APK／release；不要執行 EAS Build 或把 APK 提交到 Git。
3. 在實機至少驗證登入／匿名身份、等待或配對、聊天室捲動與鍵盤、斷線後恢復。

### Supabase

1. 建立新的時間戳 migration，內容必須可安全重跑。
2. 先做只讀確認查詢；不要用 reset、drop table 或手改舊 migration。
3. 權限、管理員操作、身份恢復、聊天室資料都必須由 RLS、RPC 或 Edge Function 驗證。
4. 套用後執行前後核對查詢，尤其確認既有兩方匿名身份、session 與訊息不受影響。

## 目前已完成的功能狀態

- 匿名 Web：首頁、等待、聊天室、登入／onboarding 與匿名身份處理。
- 連線韌性：已補 Realtime 重連與漏失狀態補同步，且移除一個重複 reconnect 迴圈；改動時避免重新引入雙重訂閱或 polling + Realtime 疊加。
- 聊天室：全螢幕／無外框版面、回到底部、1000 則訊息 `LEGENDARY CHAT` 彩蛋（粒子、音效與輕震動）。
- 彩蛋：事件記錄與管理端分析頁已存在；測試入口只可限指定測試帳號。
- 身份恢復：首頁可用匿名名稱申請恢復碼；管理端可看到待處理／過期申請，並可在核對後恢復 A 或 B 方、重新啟用過期申請。
- 管理員回覆：目前是「管理員限定測試」實作，先以文字引用方式送出；尚不是所有一般使用者皆可使用的完整回覆功能。未經確認不要開放。
- 管理統計：匿名聊天室統計、恢復申請、彩蛋紀錄已在程式內。

## 目前優先注意

1. Vercel 最近因 Supabase 環境變數與 Web 型別補正重新部署；任何 Web 改動都必須跑 build，不能只靠本機畫面。
2. 聊天室身份恢復屬高風險操作：先以匿名名稱、最後訊息／時間等資訊核對，再選 A 或 B 方，絕不猜測。
3. Realtime 連線錯誤應區分暫時重連與持續失敗，記錄時間、client／session、錯誤與是否恢復；不要把短暫重連當成資料遺失。
4. 流量成本要控制：訊息查詢需有限制，Realtime 訂閱需釋放；避免同時常駐輪詢與重複頻道。

## 工作慣例

- 新功能先檢查既有程式、最新 commit 與 migration；不要憑記憶重新做一套。
- 對外文案使用繁體中文；介面盡量全中文。
- 可直接執行的改動直接做並簡短回報；涉及不可逆資料操作、外部帳號權限或未知身份，先停下來核對。
- 每次交接更新本文件的「目前已完成的功能狀態」與「目前優先注意」，並附上 commit。
