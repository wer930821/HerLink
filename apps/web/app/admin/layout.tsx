export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { ReactNode } from "react";
import { Badge } from "../../components/ui";
import { AdminAccessGate } from "./access-gate";

const navItems = [
  { href: "/admin", label: "總覽" },
  { href: "/admin/sessions", label: "聊天場次" },
  { href: "/admin/recovery", label: "聊天室恢復" },
  { href: "/admin/realtime", label: "即時診斷" },
  { href: "/admin/reports", label: "檢舉管理" },
  { href: "/admin/safety", label: "安全管理" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-page">
      <div className="admin-layout">
        <AdminAccessGate>
          <header className="admin-top">
            <div className="admin-top-copy">
              <div className="admin-top-kicker">
                <span>HERLINK 管理後台</span>
                <Badge variant="neutral">營運</Badge>
              </div>
              <h1>後台總覽</h1>
              <p>營運狀態、聊天活動與安全事件集中管理。</p>
            </div>

            <nav className="admin-nav" aria-label="後台導覽">
              {navItems.map((item) => (
                <a key={item.href} className="admin-nav-link" href={item.href}>
                  {item.label}
                </a>
              ))}
            </nav>
          </header>

          <main className="admin-content">{children}</main>
        </AdminAccessGate>
      </div>
    </div>
  );
}
