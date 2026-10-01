import type { ReactNode } from "react";
import { Badge, Button, PageHero } from "../../components/ui";
import { AdminAccessGate } from "./access-gate";

const navItems = [
  { href: "/admin", label: "總覽" },
  { href: "/admin/sessions", label: "聊天場次" },
  { href: "/admin/realtime", label: "即時診斷" },
  { href: "/admin/reports", label: "檢舉管理" },
  { href: "/admin/safety", label: "安全管理" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <div className="container stack admin-layout">
        <AdminAccessGate>
          <PageHero
            compact
            kicker={
              <span className="admin-kicker">
                HerLink 管理後台 <Badge variant="neutral">營運</Badge>
              </span>
            }
            title="後台總覽"
            description="僅供固定管理員使用的營運管理面板。"
            actions={
              <nav className="admin-nav" aria-label="後台導覽">
                {navItems.map((item) => (
                  <Button key={item.href} variant="secondary" size="sm" href={item.href}>
                    {item.label}
                  </Button>
                ))}
              </nav>
            }
          />
          <main className="stack">{children}</main>
        </AdminAccessGate>
      </div>
    </div>
  );
}
