import type { ReactNode } from "react";
import Link from "next/link";

const navItems = [
  { href: "/admin", label: "總覽" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/realtime", label: "Realtime" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/safety", label: "Safety" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <div className="container stack admin-layout">
        <header className="admin-hero">
          <div className="row">
            <div className="admin-kicker">HerLink Admin Dashboard V0.1</div>
            <span className="status-badge">Operations</span>
          </div>
          <h1 className="hero-title">後台總覽</h1>
          <p className="hero-copy">給 reviewer / moderator / admin 使用的精簡 ops 面板，只讀查詢與除錯觀察。</p>
          <nav className="admin-nav" aria-label="Admin navigation">
            {navItems.map((item) => (
              <Link key={item.href} className="admin-nav-link" href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="stack">{children}</main>
      </div>
    </div>
  );
}
