import Link from "next/link";

const safetyTips = [
  "絕不向陌生人匯款。",
  "不要提供銀行、信用卡、密碼或 OTP / 驗證碼。",
  "小心投資、虛擬貨幣、外部付款與可疑網址。",
  "若內容讓您不舒服，可直接封鎖對方。",
  "檢舉後可選擇「封鎖並離開」或「繼續聊天」。",
  "單一檢舉不會自動造成永久 ban。",
  "封鎖後雙方不應再次配對。",
  "若對方聲稱知道您的真實身份、要求轉移到外部平台，或要求急迫付款，請提高警覺。",
  "18 歲以下不得使用 HerLink。",
];

export default function SafetyPage() {
  return (
    <main className="stack">
      <section className="hero">
        <p className="muted small">安全說明</p>
        <h1 className="hero-title">使用安全守則</h1>
        <p className="hero-copy">HerLink 的核心是匿名互動；在與陌生人聊天時，請把安全放在第一位。</p>
      </section>

      <section className="panel">
        <div className="title">請務必注意</div>
        <ul>
          {safetyTips.map((tip) => (
            <li key={tip} style={{ marginBottom: 12 }}>
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="title">遇到風險怎麼做</div>
        <p className="hero-copy">
          如果您懷疑對方涉及詐騙、威脅或騷擾，請優先封鎖並檢舉；若情況嚴重，也請停止互動並保留對話紀錄。
        </p>
        <div className="link-row" style={{ marginTop: 20 }}>
          <Link className="link" href="/">
            返回首頁
          </Link>
          <Link className="link" href="/terms">
            服務條款
          </Link>
          <Link className="link" href="/privacy">
            隱私權政策
          </Link>
        </div>
      </section>
    </main>
  );
}
