import Link from "next/link";

export default function SupportSuccessPage() {
  return (
    <main className="support-page support-result-page">
      <div className="support-shell support-result">
        <div className="support-result-heart" aria-hidden="true">♡</div>
        <p className="support-eyebrow">支持已完成</p>
        <h1>謝謝你支持 HerLink</h1>
        <p className="support-lead">
          這份支持會用在網站的伺服器、維護與持續開發。你的聊天功能與匿名身分不會因為支持而改變。
        </p>
        <Link href="/" className="support-primary-link">回到 HerLink</Link>
      </div>
    </main>
  );
}
