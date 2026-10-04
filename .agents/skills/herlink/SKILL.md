---
name: herlink
description: HerLink 專案長期開發規範。修改 HerLink Web、匿名聊天室、後台、Supabase、Vercel、Android APK、彩蛋、恢復流程或部署時使用。
---

# HerLink 開發 Skill

## 專案識別
- GitHub repository：`wer930821/HerLink`
- Web 正式開發與 Vercel Production 分支：`main`
- 不要把 `master` 當成 Web 正式部署分支。
- Vercel 正式專案：`her-link`
- Supabase 正式 project ID：`vrwuxjujevhgsjmdjxmc`
- TarotSite 是另一個專案，禁止混用其 Supabase。

## 工作原則
1. 修改前先讀 `main` 最新程式碼與目前架構，不可用舊對話的檔案結構直接覆蓋。
2. 匿名聊天室目前主要實作可能位於 `apps/web/app/session/[id]/RandomSessionClient.tsx`；不要假設舊版 `page.tsx` 仍是主要 Client。
3. 只做使用者要求的修改，避免把 `master` 其他未確認變更整批帶入 `main`。
4. 同步舊 commit 前先比較 `main`；必要時以等效修改重新套用，不直接 cherry-pick。
5. 修改後必須確認編譯與部署，Git commit 成功不代表完成。
6. Vercel build 失敗時讀 build logs、修正並重新部署，直到 Production READY 或明確回報阻塞。
7. 完成時回報最新 Production commit 與部署狀態。
8. 修改 TS／TSX／JS／JSON 等原始碼時，禁止把 literal `\\n` 當成實際換行寫進程式碼。自動字串替換或產生多行程式碼時必須使用真正的 newline。
9. 提交前檢查本次修改區域是否出現意外的 literal `\\n`、`\\r` 或其他跳脫字元殘留；字串內容本身刻意使用 `\\n`（例如提示文字換行）才可保留。
10. 若 GitHub Actions／TypeScript 報 invalid Unicode escape、Invalid character、Unexpected token 等語法錯誤，優先檢查是否誤把跳脫序列寫成原始碼文字，不要只修報錯單行，需掃描同次修改的所有相同模式。

## Vercel
- 專案：`her-link`
- Production 來源：GitHub `main`
- Web 修改後確認 target=production、githubCommitRef=main、githubCommitSha 為預期 commit、state/readyState=READY。
- 最新 deployment 為 ERROR 時不可回報「已完成」。
- 必要時驗證正式頁面實際功能，不只看部署狀態。

## Supabase
- HerLink project ID：`vrwuxjujevhgsjmdjxmc`
- HerLink DB/Auth/RLS/RPC/Realtime 操作只使用此 project，除非使用者明確指定其他專案。
- 修改前檢查現有 schema/function/policy，不猜測。
- 私人聊天室、恢復申請、彩蛋事件等資料使用 Supabase 查詢，不用公開 Web。
- DB 修改後必須執行驗證查詢。

## Android / APK
- HerLink Android build 只走 GitHub Actions。
- 禁止使用 EAS Build，除非使用者日後明確撤銷。
- App 內更新與 APK 發布沿用現有 GitHub Actions / GitHub Release 架構。
- UI 文案使用繁體中文，避免不必要英文介面。

## 匿名聊天室
- 核心為匿名聊天室。
- 「配對新的人」應進入新配對流程，不應跳回舊聊天室。
- UI 修改不得破壞聊天紀錄、匿名名稱、session 身份與恢復流程。
- Desktop/mobile 修改注意全屏布局、輸入框、送出按鈕、鍵盤遮擋、React hydration/event binding。
- 不要把聊天室回退成舊版中央窄版布局。

## 彩蛋
- 現有文字彩蛋與里程碑彩蛋屬正式功能。
- 1000：LEGENDARY CHAT／傳說級聊天室。
- 規劃高階里程碑：2000 史詩級聊天室、3000 靈魂同頻、5000 命定聊天室、10000 永恆聊天室。
- 高階里程碑目前先私人測試，不得自行公開給一般使用者。
- 私人測試按鈕不得新增聊天訊息、搶輸入框焦點或建立真正里程碑事件。
- 管理員／彩蛋測試匿名名稱：`孤星企鵝`。
- 固定 UID 白名單需以正式 Supabase 現況核對，避免沿用過期 UID。
- 正式里程碑：同 session 同里程碑只建立一次 event；雙方各自保留 delivery。
- 既有 session 日後正式開放高階里程碑時需考慮 retroactive unlock，重新整理不可重複觸發。

## 恢復聊天室
- 使用 8 碼恢復碼。
- 管理員恢復 A/B 方前應可核對匿名名稱與最近訊息。
- 修復流程不得破壞現有聊天室或聊天紀錄。
- 遇到 anonymous display name unique constraint 或 random_chat_sessions canonical pair constraint，先檢查現有關聯，不直接硬插資料。

## Realtime 與診斷
- 連線錯誤優先看近 1／5／10／60 分鐘，不用歷史累計直接判斷目前故障。
- 異常至少核對事件時間、client/session、錯誤訊息與後續是否恢復。
- 避免 polling 與 Realtime 重複造成不必要流量。

## 完成定義
1. 程式已提交正確分支。
2. Web 已確認 Vercel Production READY；Android 已確認 GitHub Actions build 狀態。
3. 必要 Supabase 修改已驗證。
4. 未混入其他專案或舊分支設定。
5. 回報實際 commit、部署狀態與必要驗證結果。
