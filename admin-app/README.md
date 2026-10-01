# HerLink 後台 App

獨立 Android 後台 App。App 內直接開啟正式 HerLink 管理後台，登入與管理權限仍由原本 Web 後台驗證。

## 本機執行

```bash
cd admin-app
npm install
npx expo start
```

## 產生 APK

```bash
cd admin-app
npm install
npx eas build --platform android --profile production
```

Android 套件名稱：`com.wer93.herlinkadmin`
