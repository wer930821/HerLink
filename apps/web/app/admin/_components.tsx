"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function AdminSection({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <div>
          <h2 className="admin-card-title">{title}</h2>
          {description ? <p className="admin-card-description">{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`admin-stat admin-stat-${tone}`}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
    </div>
  );
}

export function AdminStatGrid({ children }: { children: ReactNode }) {
  return <div className="admin-stat-grid">{children}</div>;
}

export function AdminTableWrap({ children }: { children: ReactNode }) {
  return <div className="admin-table-wrap">{children}</div>;
}

export function AdminTable({ children }: { children: ReactNode }) {
  return <table className="admin-table">{children}</table>;
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <div className="admin-empty">{children}</div>;
}

export function AdminToolbar({ children }: { children: ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

export function AdminBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>;
}

export function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="admin-link" href={href}>
      {children}
    </Link>
  );
}

export function formatAdminTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortId(value: string, length = 8) {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}
