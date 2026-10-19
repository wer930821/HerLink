import { Button, PageHero, Surface } from "../../components/ui";

const items = [
  "HerLink 不要求您以公開真實姓名、Email、生日、城市或照片作為匿名聊天的必要條件。",
  "平台會處理 Supabase 匿名驗證使用者 ID、工作階段、配對、訊息，以及安全、檢舉與封鎖紀錄。",
  "為了防止濫用，平台可能保存低侵入性的安裝識別碼或其他必要的防濫用訊號。",
  "HerLink 不使用侵入式裝置指紋辨識，例如 canvas、字型或 WebGL 指紋辨識。",
  "IP 或單一訊號不會作為永久封鎖的唯一依據；必要時僅作為風險評估的一部分。",
  "訊息可能被安全系統分析，以辨識詐騙、匯款、投資、驗證碼、惡意連結等風險行為。",
  "檢舉與封鎖目標由後端根據使用者 ID 與工作階段推導，不依賴匿名顯示名稱。",
  "用戶端不會暴露伺服器金鑰、風險雜湊值、內部風險分數或其他敏感安全資料。",
  "HerLink 的服務依賴 Supabase、Vercel 與相關基礎設施，資料處理以當前實際提供的功能為限。",
];

export default function PrivacyPage() {
  return (
    <main className="stack">
      <PageHero
        kicker="法律文件"
        title="隱私權政策"
        description="本政策說明 HerLink 目前實際會處理哪些資料，以及我們如何保護您的匿名性與安全。"
      />

      <Surface elevation={1}>
        <div className="title">我們會處理的資料</div>
        <ul>
          {items.map((item) => (
            <li key={item} style={{ marginBottom: 12 }}>
              {item}
            </li>
          ))}
        </ul>
      </Surface>

      <Surface elevation={1}>
        <div className="title">資料使用原則</div>
        <p className="hero-copy">
          HerLink 僅在提供匿名聊天、配對、檢舉、封鎖與安全防護所必要的範圍內使用資料，不會為未提供的功能額外蒐集或虛構用途。
        </p>
        <div className="link-row link-row-spaced">
          <Button variant="link" href="/">返回首頁</Button>
          <Button variant="link" href="/terms">服務條款</Button>
          <Button variant="link" href="/safety">安全說明</Button>
        </div>
      </Surface>
    </main>
  );
}
