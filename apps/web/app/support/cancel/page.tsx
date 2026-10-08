import Link from "next/link";

export default function SupportCancelPage() {
  return (
    <main className="support-page support-result-page">
      <div className="support-shell support-result">
        <div className="support-result-heart muted-heart" aria-hidden="true">♡</div>
        <p className="support-eyebrow">付款未完成</p>
        <h1>這次沒有完成付款</h1>
        <p className="support-lead">
          沒關係，你仍然可以正常使用 HerLink 的所有免費核心功能，也不會影響配對順位或聊天權限。
        </p>
        <div className="support-result-actions">
          <Link href="/support" className="support-primary-link">返回支持頁</Link>
          <Link href="/" className="support-secondary-link">回到 HerLink</Link>
        </div>
      </div>
    </main>
  );
}
