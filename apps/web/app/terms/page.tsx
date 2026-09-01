import { Button, PageHero, Surface } from "../../components/ui";

const rules = [
  "HerLink 是匿名隨機聊天服務，主要提供使用者在不公開真實身份的情況下進行配對與對話。",
  "本服務僅限 18 歲以上人士使用；若您未滿 18 歲，請勿使用本服務。",
  "使用者不得從事詐騙、騷擾、威脅、仇恨、冒名、垃圾訊息、散布惡意內容或任何違法活動。",
  "不得要求陌生人匯款、投資、提供銀行資料、信用卡資料、密碼、一次性驗證碼或任何敏感憑證。",
  "HerLink 得基於安全、濫用、防詐或系統維護需求，限制、暫停或終止您的使用資格。",
  "匿名不代表無法被平台識別；平台仍可能透過後端帳號、session 與風險訊號執行必要安全措施。",
  "HerLink 不保證一定能配對成功，也不保證服務永不中斷。",
  "您應自行判斷與陌生人互動的風險，並對自身行為負責。",
  "本條款可能因產品、法規或安全需求而更新，更新後將以最新版本為準。",
];

export default function TermsPage() {
  return (
    <main className="stack">
      <PageHero
        kicker="法律文件"
        title="服務條款"
        description="請在使用 HerLink 前閱讀本條款。繼續使用本服務，即表示您同意遵守以下內容。"
      />

      <Surface elevation={1}>
        <div className="title">適用範圍</div>
        <p className="hero-copy">本條款適用於 HerLink 的匿名登入、配對、聊天、檢舉、封鎖及其他相關功能。</p>
      </Surface>

      <Surface elevation={1}>
        <div className="title">主要條款</div>
        <ul>
          {rules.map((rule) => (
            <li key={rule} style={{ marginBottom: 12 }}>
              {rule}
            </li>
          ))}
        </ul>
      </Surface>

      <Surface elevation={1}>
        <div className="title">補充說明</div>
        <p className="hero-copy">
          若您不同意本條款任何內容，請立即停止使用 HerLink。繼續使用本服務，即視為您已理解並接受本條款及其後續更新。
        </p>
        <div className="link-row link-row-spaced">
          <Button variant="link" href="/">返回首頁</Button>
          <Button variant="link" href="/privacy">隱私權政策</Button>
          <Button variant="link" href="/safety">安全說明</Button>
        </div>
      </Surface>
    </main>
  );
}
