# HerLink App（WebView 版）

給使用者用的 Android App，做法與 `admin-app` 相同：Expo WebView 包裝正式站
`https://her-link-ten.vercel.app`，網站更新即同步，App 本身只負責殼、
返回鍵行為與 App 內更新（讀 Releases `app-latest` 的 `app-update-info.json`）。

圖示與啟動圖沿用 repo 根目錄 `assets/images/` 的品牌圖（app.json 以相對路徑引用，
不另存一份）。

## 本機執行

```bash
cd user-app
npm install
npx expo start
```

## 產生 APK

推送到 main 且動到 `user-app/**`，或在 GitHub Actions 手動執行
「Build HerLink App APK」workflow；成品發佈到 Releases `app-latest`
（HerLink.apk ＋ app-update-info.json）。

Android 套件名稱：`com.wer93.herlink`（與舊原生 App 相同，可直接覆蓋安裝接手）
