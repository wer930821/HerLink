# HerLink DeepSeek AI 維修員：安全試跑版設計

日期：2026-10-08
狀態：待使用者審閱
基準分支：`main`

## 1. 目標

建立與既有 DeepSeek 陪聊小幫手隔離的 AI 維修員。當 HerLink 發生值得處理的系統錯誤時，可自動建立維修任務；管理員也能在後台手動交辦問題。AI 可分析錯誤、產生修復 patch、執行驗證，成功後建立獨立修復 branch 與 PR，等待人工審核。

安全試跑版不得自動修改 `main`、不得直接部署、不得修改 Supabase、不得刪除資料。

## 2. 已確認需求

- 模式：自動偵測 + 後台手動交辦。
- 修復輸出：產生可審核修復，建立獨立 branch / PR。
- 同一問題最多自動修復 2 次。
- 第一次驗證失敗，可把失敗資訊交回 AI 再嘗試一次。
- 第二次仍失敗，停止並標記「需要人工處理」。
- AI 可修改範圍僅限 `apps/web/**`。
- 既有 DeepSeek API Key 可共用，但維修 Agent 的 Prompt、路由、權限與陪聊功能隔離。

## 3. 硬性安全邊界

AI 維修員永遠不得：

- 寫入、合併或 force push `main`。
- 修改 `supabase/**` 或執行 migration / SQL schema 變更。
- 修改 `.github/**` 或 GitHub Actions workflow。
- 讀取、修改或輸出 `.env*`、Secrets、API Key、Service Role Key 等敏感值。
- 刪除正式資料、聊天室、帳號或身份資料。
- 直接觸發 Production 部署。
- 修改 `apps/web/**` 以外的 repo 檔案。

任何 patch 只要包含禁區路徑或危險操作，安全檢查立即拒絕，且不得建立修復 branch。

## 4. 系統組件

### 4.1 錯誤接收器

提供兩種入口：

1. 自動偵測：接收 HerLink Web 可觀測到的伺服器/API/前端核心錯誤事件。
2. 手動交辦：管理後台提供「交給 AI 檢查」入口，管理員輸入問題描述並附上目前可取得的錯誤資訊。

兩種入口都先轉成標準化 Maintenance Task，再進入相同維修流程。

### 4.2 錯誤分級

- P0：正式站大量 500、核心頁面不可用、配對等核心流程全面失敗。立即建立任務。
- P1：聊天室核心功能（例如圖片、回收、恢復、主要 API）持續失敗。自動建立任務。
- P2：單一功能偶發錯誤。只有同類錯誤在短時間重複達門檻才建立任務。
- P3：一般 404、使用者取消、單次斷網、偶發 timeout 等低價值雜訊。只記錄，不呼叫 DeepSeek。

P2 第一版採保守門檻：同一錯誤指紋 5 分鐘內至少 3 次才升級成維修任務。

### 4.3 錯誤指紋與去重

以路由/API、錯誤類型、正規化錯誤訊息、主要 stack frame 組成 fingerprint。相同 fingerprint 在既有任務仍為 active 時，不重複建立 DeepSeek 任務，只累計發生次數與最近發生時間。

因此同一錯誤短時間發生大量次數，只會維持一個 AI 維修工作。

### 4.4 Maintenance Agent

Agent 只取得完成工作所需的最小資訊：

- 錯誤摘要與安全清理後的 stack trace。
- 對應 `apps/web/**` 程式碼。
- 上一次修復嘗試的 patch 與驗證失敗輸出（第二次嘗試時）。

Agent 不取得 Supabase 資料內容、Secrets 或 Production 寫入能力。

輸出必須是結構化修復提案，包括：根因判斷、信心程度、欲修改檔案、patch、預期修復效果與建議驗證項目。

### 4.5 Patch 安全閘門

AI 輸出不能直接寫 GitHub。由非 AI 的 deterministic guard 驗證：

- 所有修改路徑都在 `apps/web/**`。
- 不包含禁區檔案。
- 不包含 deployment / migration / destructive data operation。
- 不允許大量無關刪除；超過安全閾值時轉人工處理。
- patch 必須能乾淨套用到建立任務時記錄的 `main` 基準 SHA；基準已變動造成衝突時停止並要求人工處理，不自行覆蓋新版程式。

### 4.6 驗證器

安全閘門通過後，在隔離工作環境套用 patch，依 repo 現有 scripts 執行可用的 Web 驗證。優先順序：

1. 與修改內容直接相關的測試。
2. typecheck。
3. lint。
4. Web build。

只有所需驗證全部成功才視為修復成功。若 repo 某項 script 不存在，記錄為 unavailable，而不是偽造成功。

### 4.7 最多兩次修復

Attempt 1：錯誤資訊 + 程式碼 → DeepSeek → guard → tests。

若失敗，Attempt 2 額外提供第一次 patch 與精簡後的真實驗證失敗輸出，要求修正原提案。

Attempt 2 仍失敗：狀態改為 `needs_human`，停止 AI 呼叫與自動寫入。

安全閘門判定為高風險的修改不應透過反覆嘗試繞過；若原因是權限邊界（例如必須修改 Supabase），直接標記 `needs_human`。

## 5. GitHub 行為

修復驗證成功後才建立：

`fix/ai-maintenance-<task-id>`

Branch 從該任務記錄的 `main` 基準 SHA 建立，不直接更新 `main`。

PR base 固定為 `main`。PR 內容包含：

- 任務來源：自動 / 手動。
- P0/P1/P2 等級。
- 錯誤摘要與 fingerprint。
- AI 根因判斷。
- 修改檔案。
- 使用第幾次嘗試成功。
- 實際驗證結果。
- 明確標示「AI generated maintenance patch — requires human review」。

安全試跑版不啟用 auto-merge。

## 6. 後台 AI 維修區

第一版提供：

- 手動「交給 AI 檢查」入口。
- 任務清單。
- 問題來源與嚴重度。
- 錯誤摘要與發生次數。
- AI 根因判斷。
- 嘗試次數（0/2、1/2、2/2）。
- 修改檔案清單。
- Guard 結果。
- 測試 / typecheck / lint / build 結果。
- 修復 branch / PR 連結。
- 任務狀態。

主要狀態：`detected`、`analyzing`、`testing`、`pr_ready`、`blocked`、`needs_human`。

## 7. 資料保存方式

安全試跑版不新增 Supabase migration。維修任務與狀態不依賴新的正式資料庫 schema。

第一版優先使用 GitHub Issue / PR metadata 作為持久維修紀錄，HerLink 後台透過受保護的伺服器端 API 讀取並呈現。這可避免為了維修 Agent 本身修改 Supabase schema，也保留完整可稽核紀錄。

不得把 Secrets、完整 authorization header、使用者私人聊天內容寫入 GitHub Issue / PR。

## 8. 自動觸發限制

自動偵測必須具備 rate limit 與 fingerprint cooldown。單一 fingerprint 在 active 任務存在時不得再次呼叫 AI。

全域也設置每小時 AI 自動維修任務上限；超出時只記錄錯誤並標記待人工查看，避免異常風暴消耗 API 額度。第一版預設上限為每小時 5 個新的自動維修任務；手動管理員交辦不計入此上限，但仍受單一任務最多 2 次限制。

## 9. 錯誤與失敗處理

- DeepSeek timeout / 5xx：可在當次 attempt 內做一次網路層重試，不計為新的修復 attempt。
- DeepSeek 回傳格式錯誤：該 attempt 視為失敗。
- Patch 越權：`blocked` 或 `needs_human`，不得嘗試放寬權限。
- 基準 SHA 衝突：`needs_human`。
- 驗證失敗：若為 Attempt 1，進 Attempt 2；若為 Attempt 2，`needs_human`。
- GitHub branch / PR 建立失敗：保留已完成的分析與測試紀錄，標記 `needs_human`，不得改寫 main 作為替代方案。

## 10. 測試與驗收

至少驗證：

1. P0/P1 可建立自動任務。
2. P2 未達 3 次不呼叫 AI，5 分鐘內第 3 次才建立。
3. P3 不呼叫 AI。
4. 相同 fingerprint 不建立重複 active 任務。
5. 管理員可以手動建立任務。
6. 非管理員無法手動交辦或查看敏感維修資訊。
7. AI 修改 `apps/web/**` 可進 guard。
8. AI 嘗試修改 `supabase/**`、`.github/**`、`.env*` 或 repo 其他位置會被阻擋。
9. Attempt 1 驗證失敗可進 Attempt 2。
10. Attempt 2 失敗後停止並標記 `needs_human`。
11. 驗證全部成功後建立 `fix/ai-maintenance-*` branch 和 PR 到 `main`。
12. 不存在任何自動 merge、直接 main 寫入或 Production 部署路徑。
13. GitHub 紀錄不包含 Secrets、authorization header 或私人聊天內容。

## 11. 非目標

安全試跑版不做：

- 自動 merge PR。
- 自動 Production 部署。
- 自動修改 Supabase / migration / RLS。
- 自動處理資料修復或身份恢復。
- 修改 Web 以外的 App / 後台原生程式。
- 讓 AI 自己改變安全政策、嘗試次數或檔案 allowlist。

## 12. 成功標準

安全試跑版成功的定義是：HerLink 能把高價值 Web 錯誤自動或手動送入隔離維修流程，DeepSeek 最多嘗試兩次，只能修改 `apps/web/**`；通過 deterministic 安全檢查與真實驗證後，系統建立等待人工審核的修復 PR。任何高風險、越權或無法可靠修復的問題都停止在人工處理狀態，不影響 `main`、Supabase 或 Production。