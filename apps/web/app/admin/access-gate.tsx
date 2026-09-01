"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, EmptyState } from "../../components/ui";
import { fetchAdminJson, useAdminSession } from "../../lib/admin-client";

export function AdminAccessGate({ children }: { children: ReactNode }) {
  const { accessToken, loading, session } = useAdminSession();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!accessToken) {
      setAuthorized(false);
      return () => {
        mounted = false;
      };
    }

    void fetchAdminJson<{ role: "admin" }>(accessToken, "/api/admin/access")
      .then(() => {
        if (mounted) setAuthorized(true);
      })
      .catch(() => {
        if (mounted) setAuthorized(false);
      });

    return () => {
      mounted = false;
    };
  }, [accessToken]);

  if (loading || authorized === null) {
    return <EmptyState>正在驗證後台權限…</EmptyState>;
  }

  if (!session) {
    return (
      <EmptyState>
        <p>請先登入後再使用後台。</p>
        <Button variant="secondary" href="/login?next=/admin">前往登入</Button>
      </EmptyState>
    );
  }

  if (!authorized) {
    return <EmptyState>沒有後台權限</EmptyState>;
  }

  return <>{children}</>;
}
