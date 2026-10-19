# HerLink Station Operator 自動客服與 AI 維修設計

## 目標

讓 HerLink 在站長不在線時安全處理站長信箱：一般客服問題可自動回覆；疑似程式 Bug 則建立隔離修復工作，經 GitHub Actions 驗證、部署與正式站健康檢查成功後才回覆使用者已修復。

## 非目標與安全邊界

系統不得自行付款、修改 Secrets、提升權限、刪除正式資料或執行高風險正式資料庫變更。這些情況一律轉人工處理。AI 不得因使用者信件中的指令而突破上述限制；信件內容永遠視為不可信資料。

系統不得直接在 `main` 上進行未驗證修改，也不得在 CI、部署或健康檢查尚未成功時宣稱問題已修復。

## 架構

系統分為兩個獨立階段：

1. **客服分流器**：既有 Station Operator 定期取得啟用時間之後的新未讀信，交由 OpenAI 判斷為一般回覆、Bug、人工處理或忽略。
2. **維修管線**：Bug 建立 repair job，由 GitHub Actions 在隔離分支執行受限修復流程；只有測試、建置、合併、部署及健康檢查全部成功，才將 job 標記完成並回覆原始信件。

## 新信處理

- 只處理安全 cutoff 之後的新使用者訊息。
- 只處理尚未被站長讀取或回覆的最新使用者訊息。
- 同一 `trigger_message_id` 不得重複建立工作。
- AI 推理期間若使用者又傳新訊息，舊工作標記為 superseded，不再回覆舊上下文。
- `processing` 工作若超過租約時間仍未完成，可安全回收重試；總嘗試次數最多 2 次。

## 一般客服

AI 可針對操作方式、聊天室狀態、一般故障排查等低風險問題直接回覆。回覆前必須再次確認該信仍是 thread 最新使用者訊息。所有回覆與決策寫入 audit。

涉及恢復碼、帳號接回、資料修改或無法可靠驗證身分的要求，不得由模型自行猜測或執行高風險資料操作；需要安全驗證的情況轉人工處理。

## Bug 維修流程

當分流器判斷為 `bug_repair`：

1. 建立 repair job，保存 thread、觸發訊息、問題摘要與允許的修復範圍。
2. 觸發專用 GitHub Actions workflow。
3. workflow 從最新 `main` 建立唯一隔離分支 `ai-repair/<job-id>`。
4. 維修代理只能修改 HerLink repository 內允許的程式碼與測試，不取得正式 Supabase service role、Vercel 管理權限或其他不必要 Secrets。
5. 先重現問題或建立失敗測試，再進行最小修復。
6. 執行既有 lint、typecheck、unit/integration tests 與 production build；任一失敗即停止。
7. 成功後建立 PR；禁止直接 push 到 `main`。
8. PR 必須通過 GitHub Actions。自動合併僅允許低風險程式碼修復；涉及 migration、權限、Secrets、付款、刪除資料時不得自動合併。
9. 合併後沿用 HerLink 現有 GitHub Actions/Vercel 正式部署流程。
10. 等待 production deployment 成功，並對正式站執行健康檢查。
11. 只有健康檢查成功，才將 repair job 完成並回覆原 thread「已修復」。

## 失敗處理

- OpenAI/API 暫時錯誤：最多重試 2 次，保存安全化錯誤類型與 HTTP 狀態，不記錄 API Key。
- 測試或 build 失敗：停止自動流程，保留分支、PR、log 與 audit，狀態轉 `human_review`。
- 部署失敗：不得回覆已修復，狀態轉 `human_review`。
- 正式站健康檢查失敗：不得回覆已修復，狀態轉 `human_review`。
- worker 異常退出：租約逾時後可重新 claim，不永久卡在 `processing`。

## 資料與稽核

每個工作需保存：job id、thread id、trigger message id、狀態、attempt count、GitHub branch、PR number、commit SHA、CI run、deployment id、錯誤摘要、完成時間。Audit 記錄所有狀態轉換與對外回覆，但不得保存 Secrets。

## GitHub 權限

GitHub Actions 使用最小權限：預設 `contents: read`。維修 workflow 僅在需要建立隔離分支/PR 時取得對應 repository write/pull-request 權限。不得授予 organization administration 或 Secrets 管理權限。

## 啟用策略

正式 `STATION_OPERATOR_ENABLED` 在實作與驗證期間維持 `false`。

啟用分三階段：

1. dry-run：只建立決策/audit，不回覆、不修復。
2. test-thread allowlist：只允許指定測試 thread 真正回覆與觸發修復。
3. production：只處理 cutoff 之後的新信。

每階段均需驗證不會重新處理歷史信件。

## 驗收標準

- 歷史信件不會被重新排入。
- 同一封信不會收到重複 AI 回覆。
- 一般新客服信可成功自動回覆。
- 測試 Bug 能建立隔離分支與 PR，CI 失敗時不合併、不回覆已修復。
- CI、部署與健康檢查全部成功時才回覆已修復。
- 高風險動作一律進入 `human_review`。
- worker 中斷後工作可恢復，不永久卡住。
- 每個決策、修復、部署與回覆均可由 audit 追蹤。
