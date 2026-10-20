import { Button, PageHero, Surface } from "../../components/ui";

export default function DataDeletionPage() {
  return (
    <main className="stack">
      <PageHero
        kicker="隱私與資料控制"
        title="刪除 HerLink 資料"
        description="您可以要求刪除與目前匿名身分相關的 HerLink 資料。這個頁面也提供給未安裝 App 的使用者提出刪除要求。"
      />

      <Surface elevation={1}>
        <div className="title">可以要求刪除哪些資料</div>
        <p className="hero-copy">
          可要求刪除或解除與匿名身分相關的個人檔案、配對、聯絡人與其他可合理辨識為您的服務資料。基於安全、防詐、法律義務或爭議處理所必要的紀錄，可能依法或依合理安全期間保留後再刪除或去識別化。
        </p>
      </Surface>

      <Surface elevation={1}>
        <div className="title">如何提出要求</div>
        <ol>
          <li style={{ marginBottom: 12 }}>開啟 HerLink 的「站長信箱」。</li>
          <li style={{ marginBottom: 12 }}>主旨填寫「刪除資料申請」。</li>
          <li style={{ marginBottom: 12 }}>請提供目前匿名暱稱，以及可用來確認身分的恢復碼或其他必要資訊；請勿提供密碼、銀行資料或一次性驗證碼。</li>
          <li>站長確認身分與刪除範圍後會處理申請；如有依法或安全需要保留的資料，會在回覆中說明。</li>
        </ol>
        <div className="link-row link-row-spaced">
          <Button variant="link" href="/mailbox">前往站長信箱</Button>
          <Button variant="link" href="/privacy">隱私權政策</Button>
          <Button variant="link" href="/terms">服務條款</Button>
        </div>
      </Surface>

      <Surface elevation={1}>
        <div className="title">重要提醒</div>
        <p className="hero-copy">
          資料刪除可能使匿名身分、聯絡人、聊天室或恢復功能無法再使用。正式處理前，站長可能需要再次確認申請內容，避免他人冒用您的身分要求刪除。
        </p>
        <Button variant="link" href="/">返回 HerLink 首頁</Button>
      </Surface>
    </main>
  );
}
