# HerLink 匿名聊天室帳號綁定設計

日期：2026-10-05
狀態：待使用者確認

## 目標

HerLink 維持「先匿名、零註冊門檻」的使用方式；使用者聊過之後可選擇「保存我的聊天室」綁定帳號。綁定後即使更換手機、瀏覽器、清除網站資料或退出無痕視窗，只要重新登入即可找回已歸戶的匿名身分與聊天室。

最高原則：不搬移、不重建、不刪除既有 `random_chat_sessions`、訊息或匿名身分。帳號只是匿名身分的所有權證明，聊天對象永遠看不到登入帳號資料。

## 架構

採用 Account -> Identity -> Chat Participant/Session 三層模型。

- Account：Supabase Auth 帳號，只負責登入與所有權。
- Identity：HerLink 匿名身分，保留匿名名稱、既有聊天室關係與恢復資訊。
- Session/Participant：既有聊天室與雙方關係，第一階段不改寫既有 session 主鍵與訊息關聯。

未綁定使用者仍以目前匿名流程使用。綁定時只新增 Account 與既有 Identity 的關聯，不複製聊天室。

同一 Account 可以擁有多個歷史 Identity。若使用者在不同裝置各自建立匿名身分後再登入同一帳號，兩個 Identity 都歸到該 Account，但不互相合併資料，避免名稱唯一限制、canonical pair 與歷史訊息關聯被破壞。

## 資料模型

新增 `account_identities`（實際欄位名稱可依現有 profile schema 微調）：

- `id uuid primary key`
- `account_user_id uuid not null references auth.users(id)`
- `identity_id uuid not null`
- `bound_at timestamptz not null default now()`
- `is_primary boolean not null default false`
- `created_at timestamptz not null default now()`
- unique `(account_user_id, identity_id)`
- 每個 identity 同時間只能有一個有效 account owner。

新增 `identity_migrations` 作為不可變更的操作紀錄：

- identity
- from/to account
- operation (`bind`, `rebind`, `admin_recover`)
- status
- error（不得存聊天內容或敏感登入資訊）
- created/completed time
- admin actor（僅管理操作時）

第一階段不刪除現有恢復碼欄位與恢復申請表。

## 綁定流程

1. 使用者照現況匿名進站並聊天。
2. 在首頁/聊天室聯絡人區提供「保存我的聊天室」。不強制登入。
3. 使用者完成 Supabase Auth 登入。
4. 伺服端受保護 RPC 取得 `auth.uid()`，驗證目前瀏覽器持有的匿名 identity。
5. transaction/原子操作建立 `account_identities` ownership 與 migration log。
6. 成功後重新查詢帳號擁有的 identities，前端顯示已保存。
7. 不改 session id、message id、匿名名稱、聯絡人、彩蛋事件或既有恢復碼。

登入帳號本來已有 identity 時，新 identity 加入同一 account，不進行破壞性 merge。

## 跨裝置與聊天室歸戶

登入後聊天室來源改為：

`auth.uid() -> account_identities -> identities -> existing sessions`

匿名狀態仍走現有本機 identity 流程。因此功能可以漸進上線，不要求既有使用者一次轉換。

如果帳號有多個 identities，前端將其聊天室合併成一份「我的聊天室」列表；資料庫仍保留各 identity 原始歸屬。

## 未讀

未讀狀態改為 server-authoritative，不再以單一瀏覽器 localStorage 作為真實來源。

新增/沿用每個 identity + session 的 read cursor：

- `last_read_message_id`
- `last_read_at`

只有聊天室實際處於前景且最新訊息已載入時才更新 read cursor。其他裝置透過 Realtime/重新查詢同步。這可避免人在聊天室中仍被自己剛讀過的訊息計入未讀。

若第一階段發現現有 participant schema 不適合直接加欄位，使用獨立 `chat_read_states(session_id, identity_id, ...)`，不重構 session。

## 通知

Push subscription 與 identity/account 分離：匿名使用者可先綁 identity；帳號綁定後可將 subscription 解析到 account，支援多裝置。

通知發送規則：

- 新訊息屬於對方時才計算通知。
- 正在前景查看該 session 的裝置不推送該聊天室通知。
- 其他已啟用裝置可收到 Web/裝置通知。
- 預設通知只顯示「你收到一則新訊息」，不在鎖定畫面暴露聊天內容。

## 失敗與備援

綁定必須是原子操作。任何 ownership 驗證、unique constraint 或 RPC 錯誤都不得修改既有聊天室資料。

失敗時顯示：「帳號尚未完成綁定，你目前的匿名聊天室沒有受到影響。」並允許重試。

現有 8 碼恢復流程保留，定位改為緊急備援：

- 尚未綁定就遺失本機 identity
- 登入供應商失效
- 綁錯帳號
- ownership migration 異常

管理員恢復前仍需核對匿名名稱、最後訊息/時間等資訊，不自動猜 A/B 方。

## RLS / 安全

- Client 不可直接指定 `account_user_id` 替別人綁定。
- 綁定 RPC 的 account 一律取 `auth.uid()`。
- identity ownership 必須用現有匿名身分憑證/恢復機制驗證。
- 查聊天室時必須確認登入帳號確實擁有對應 identity。
- 管理員 rebind/recover 走受保護 RPC 或 Edge Function，另寫 audit log。
- 不把 email、Google profile 等登入資料暴露給聊天對象。

## 舊資料 Migration

Migration 只建立新表、index、RLS/RPC；不批次改寫既有聊天室。

既有使用者第一次選擇保存時才建立 ownership。未選擇者資料與體驗保持原樣。

Migration 必須可重跑，並附只讀驗證：

- migration 前後 session 數一致
- message 數一致
- 既有 session A/B identity 關聯一致
- 沒有 orphan ownership
- 沒有一個 identity 被兩個 account 同時擁有

## UI

匿名使用時顯示低干擾入口「保存我的聊天室」。說明文字明確表示：

「綁定後，換手機或清除瀏覽器資料也能重新登入找回聊天室。你的登入帳號不會顯示給聊天對象。」

綁定成功顯示「聊天室已保存」。不要把 HerLink 改成登入牆；使用者永遠可以先匿名開始聊天。

## 測試

至少覆蓋：

1. 新匿名使用者不登入仍可正常配對聊天。
2. 有既有聊天室的匿名 identity 綁定後 session/message ID 完全不變。
3. 新瀏覽器登入同帳號可取得原聊天室。
4. 同帳號已有另一 identity 時可同時看到兩邊聊天室，不發生 destructive merge。
5. 綁定中途失敗後匿名聊天室仍可正常使用。
6. 登出後本機匿名 fallback 不會錯綁其他 account。
7. 多裝置已讀同步，自己正在看的聊天室不殘留未讀。
8. Push 不向前景中的同一聊天室裝置重複提醒。
9. 舊 8 碼恢復流程仍可使用。
10. RLS 無法讀取不屬於登入帳號的 identity/chat。

Web 變更完成後依工作區規則執行 `npm ci --prefix apps/web`、`npm run typecheck --prefix apps/web`、`npm run build --prefix apps/web`。資料庫變更另執行 migration 前後只讀核對。

## 分階段上線

Phase 1：Account/Identity ownership + 「保存我的聊天室」+ 跨瀏覽器登入恢復。

Phase 2：Server-side read state + 多裝置未讀同步。

Phase 3：Push subscriptions account 歸戶 + 多裝置通知。

Phase 4：管理端 ownership/migration 檢視與安全 rebind 工具。

每一階段都必須能獨立回退前端功能，且不得靠刪除既有資料回退。