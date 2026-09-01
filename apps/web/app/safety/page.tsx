import { Button, PageHero, Surface } from "../../components/ui";

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
      <PageHero
        kicker="安全說明"
        title="使用安全守則"
        description="HerLink 的核心是匿名互動；在與陌生人聊天時，請把安全放在第一位。"
      />

      <Surface elevation={1}>
        <div className="title">請務必注意</div>
        <ul>
          {safetyTips.map((tip) => (
            <li key={tip} style={{ marginBottom: 12 }}>
              {tip}
            </li>
          ))}
        </ul>
      </Surface>

      <Surface elevation={1}>
        <div className="title">遇到風險怎麼做</div>
        <p className="hero-copy">
          如果您懷疑對方涉及詐騙、威脅或騷擾，請優先封鎖並檢舉；若情況嚴重，也請停止互動並保留對話紀錄。
        </p>
        <div className="link-row link-row-spaced">
          <Button variant="link" href="/">返回首頁</Button>
          <Button variant="link" href="/terms">服務條款</Button>
          <Button variant="link" href="/privacy">隱私權政策</Button>
        </div>
      </Surface>
    </main>
  );
}
