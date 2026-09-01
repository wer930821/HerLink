import type { ReactNode } from "react";
import { Badge, Button, PageHero } from "../../components/ui";

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
        <PageHero
          compact
          kicker={
            <span className="admin-kicker">
              HerLink Admin Dashboard V0.1 <Badge variant="neutral">Operations</Badge>
            </span>
          }
          title="後台總覽"
          description="給 reviewer / moderator / admin 使用的精簡 ops 面板，只讀查詢與除錯觀察。"
          actions={
            <nav className="admin-nav" aria-label="Admin navigation">
              {navItems.map((item) => (
                <Button key={item.href} variant="secondary" size="sm" href={item.href}>
                  {item.label}
                </Button>
              ))}
            </nav>
          }
        />
        <main className="stack">{children}</main>
      </div>
    </div>
  );
}
