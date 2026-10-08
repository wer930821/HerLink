import Link from "next/link";

const supportAmounts = [
  { amount: 30, label: "給 HerLink 一點電力" },
  { amount: 50, label: "請站長喝杯飲料" },
  { amount: 100, label: "支持網站繼續長大" },
  { amount: 300, label: "大力支持 HerLink" },
];

export default function SupportPage() {
  return (
    <main className="support-page">
      <div className="support-shell">
        <Link href="/" className="support-back" aria-label="返回 HerLink 首頁">
          ← 返回 HerLink
        </Link>

        <header className="support-hero">
          <div className="support-heart" aria-hidden="true">♡</div>
          <p className="support-eyebrow">讓這個小地方繼續亮著</p>
          <h1>支持 HerLink</h1>
          <p className="support-lead">
            HerLink 的核心聊天功能都可以免費使用。如果你喜歡這裡，也願意支持網站持續營運，可以請站長喝杯飲料。
          </p>
        </header>

        <section className="support-section" aria-labelledby="support-amount-title">
          <h2 id="support-amount-title">選擇支持金額</h2>
          <p className="support-muted">目前為送審展示頁，付款功能會在金流審核完成後開放。</p>
          <div className="support-amount-grid">
            {supportAmounts.map(({ amount, label }) => (
              <button key={amount} type="button" className="support-amount" disabled>
                <strong>NT${amount}</strong>
                <span>{label}</span>
              </button>
            ))}
            <button type="button" className="support-amount support-amount-custom" disabled>
              <strong>自訂金額</strong>
              <span>依你的心意支持</span>
            </button>
          </div>
        </section>

        <section className="support-section support-copy" aria-labelledby="support-anonymous-title">
          <h2 id="support-anonymous-title">匿名支持</h2>
          <p>
            支持 HerLink 完全自願。是否支持都不影響配對順位、聊天權限或任何免費核心功能。
          </p>
          <p>
            HerLink 不要求你提供匿名聊天暱稱、聊天室資訊或恢復碼，也不會主動把支持紀錄與匿名聊天身分建立關聯。付款時所需資料將依第三方金流服務商的付款流程與規範處理。
          </p>
        </section>

        <section className="support-section support-copy" aria-labelledby="support-use-title">
          <h2 id="support-use-title">支持會用在哪裡？</h2>
          <p>
            支持款項主要用於 HerLink 的伺服器、網路服務、系統維護、功能開發及相關營運成本，讓網站能持續維持與改善。
          </p>
        </section>

        <section className="support-section support-copy" aria-labelledby="support-refund-title">
          <h2 id="support-refund-title">取消與退款說明</h2>
          <p>
            目前尚未開放付款，因此不會產生任何扣款。正式開放後，如發生重複扣款、付款異常或其他交易問題，可透過 HerLink 站長信箱聯絡，我們會依實際交易狀況協助確認與處理。
          </p>
        </section>

        <section className="support-section support-copy" aria-labelledby="support-contact-title">
          <h2 id="support-contact-title">客服與聯絡</h2>
          <p>
            使用 HerLink 網站內的「站長信箱」即可聯絡。付款相關問題請保留交易資訊，方便後續確認。
          </p>
        </section>

        <div className="support-coming-soon" aria-disabled="true">
          付款功能準備中
        </div>
        <p className="support-footnote">不支持也沒關係，HerLink 的免費核心功能不會因此受到限制。</p>
      </div>
    </main>
  );
}
