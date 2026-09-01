import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="site-footer-brand">HerLink — 匿名隨機聊天</div>
        <nav className="site-footer-links" aria-label="頁尾導覽">
          <Link className="site-footer-link" href="/terms">
            服務條款
          </Link>
          <Link className="site-footer-link" href="/privacy">
            隱私權政策
          </Link>
          <Link className="site-footer-link" href="/safety">
            安全說明
          </Link>
        </nav>
        <div className="site-footer-note">18 歲以上才可使用 HerLink。</div>
      </div>
    </footer>
  );
}
