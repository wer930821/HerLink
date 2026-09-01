"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminPaginationResult, AdminSessionListItem } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, AdminToolbar, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

type SessionListPayload = AdminPaginationResult<AdminSessionListItem>;

const statusOptions = ["all", "waiting", "matched", "ended"] as const;

export default function AdminSessionsPage() {
  const { session, loading, accessToken } = useAdminSession();
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("all");
  const [data, setData] = useState<SessionListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const sessionState = useMemo(() => {
    if (loading) return "loading";
    if (!session) return "signed_out";
    if (!accessToken) return "missing_token";
    return "ready";
  }, [accessToken, loading, session]);

  const load = async () => {
    if (!accessToken) return;
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "20", status });
      const result = await fetchAdminJson<SessionListPayload>(accessToken, `/api/admin/sessions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入 sessions。");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, status]);

  if (sessionState === "loading") {
    return <AdminEmpty>正在載入後台驗證…</AdminEmpty>;
  }

  if (sessionState !== "ready") {
    return <AdminEmpty>請先登入後再使用後台。</AdminEmpty>;
  }

  return (
    <div className="stack">
      <AdminSection
        title="Sessions"
        description="依狀態瀏覽會話，點入可查看完整對話與安全事件。"
        action={
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <AdminToolbar>
          {statusOptions.map((item) => (
            <Button
              key={item}
              variant={status === item ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() => setStatus(item)}
            >
              {item === "all" ? "全部" : item}
            </Button>
          ))}
        </AdminToolbar>
        {data?.items?.length ? (
          <AdminTableWrap>
            <AdminTable label="Sessions 列表">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">狀態</th>
                  <th scope="col">訊息</th>
                  <th scope="col">最後訊息</th>
                  <th scope="col">標記</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{shortId(item.id)}</td>
                    <td>
                      <AdminBadge tone={item.status === "ended" ? "warning" : item.status === "matched" ? "success" : "default"}>{item.status}</AdminBadge>
                    </td>
                    <td>{item.message_count}</td>
                    <td>{formatAdminTime(item.last_message_at)}</td>
                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        {item.has_report ? <AdminBadge tone="warning">report</AdminBadge> : null}
                        {item.has_block ? <AdminBadge tone="danger">block</AdminBadge> : null}
                        {item.has_fraud_risk_event ? <AdminBadge tone="danger">fraud</AdminBadge> : null}
                      </div>
                    </td>
                    <td>
                      <Button variant="secondary" size="sm" href={`/admin/sessions/${item.id}`}>檢視</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableWrap>
        ) : (
          <AdminEmpty>目前沒有符合條件的 sessions。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
