import Link from "next/link";

const navItems = [
  { href: "/", label: "首頁" },
  { href: "/safety", label: "安全說明" },
  { href: "/terms", label: "服務條款" },
  { href: "/privacy", label: "隱私權政策" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="site-logo" aria-label="HerLink 首頁">
          HerLink
        </Link>
        <nav className="site-nav" aria-label="主要導覽">
          {navItems.map((item) => (
            <Link key={item.href} className="site-nav-link" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
