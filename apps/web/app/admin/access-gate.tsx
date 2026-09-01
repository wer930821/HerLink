"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, EmptyState } from "../../components/ui";
import { fetchAdminJson, useAdminSession } from "../../lib/admin-client";

type AdminDebug = {
  user_id: string;
  email: string | null;
  admin_row_exists: boolean;
  role: string | null;
  active: boolean;
  authorized: boolean;
};

export function AdminAccessGate({ children }: { children: ReactNode }) {
  const { accessToken, loading, session } = useAdminSession();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debug, setDebug] = useState<AdminDebug | null>(null);

  useEffect(() => {
    setDebugEnabled(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

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

  useEffect(() => {
    if (!debugEnabled || !accessToken) return;

    void fetch("/api/admin/debug?debug=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AdminDebug>;
      })
      .then(setDebug)
      .catch(() => setDebug(null));
  }, [accessToken, debugEnabled]);

  const debugPanel = debugEnabled ? (
    <pre className="debug-panel">
      {JSON.stringify(
        {
          browser_session_user_id: session?.user.id ?? null,
          browser_session_email: session?.user.email ?? null,
          server_jwt_user_id: debug?.user_id ?? null,
          server_jwt_email: debug?.email ?? null,
          admin_row_exists: debug?.admin_row_exists ?? null,
          role: debug?.role ?? null,
          active: debug?.active ?? null,
          authorization_result: debug?.authorized ?? false,
        },
        null,
        2
      )}
    </pre>
  ) : null;

  if (loading || authorized === null) {
    return <EmptyState>正在驗證後台權限…{debugPanel}</EmptyState>;
  }

  if (!session) {
    return (
      <EmptyState>
        <p>請先登入後再使用後台。</p>
        <Button variant="secondary" href="/login?next=/admin">前往登入</Button>
        {debugPanel}
      </EmptyState>
    );
  }

  if (!authorized) {
    return <EmptyState>沒有後台權限{debugPanel}</EmptyState>;
  }

  return <>{debugPanel}{children}</>;
}
