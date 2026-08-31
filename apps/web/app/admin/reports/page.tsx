"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminPaginationResult, AdminReportListItem } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, AdminToolbar, formatAdminTime, shortId } from "../_components";

type ReportPayload = AdminPaginationResult<AdminReportListItem>;

const statusOptions = ["all", "open", "reviewing", "resolved", "dismissed"] as const;

export default function AdminReportsPage() {
  const { session, loading, accessToken } = useAdminSession();
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("all");
  const [data, setData] = useState<ReportPayload | null>(null);
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
      const result = await fetchAdminJson<ReportPayload>(accessToken, `/api/admin/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入 reports。");
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
        title="Reports"
        description="依狀態檢視檢舉資料與關聯 session。"
        action={
          <button className="button secondary" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "重新整理中…" : "重新整理"}
          </button>
        }
      >
        {error ? <div className="banner">{error}</div> : null}
        <AdminToolbar>
          {statusOptions.map((item) => (
            <button
              key={item}
              className={status === item ? "button" : "button secondary"}
              type="button"
              onClick={() => setStatus(item)}
            >
              {item === "all" ? "全部" : item}
            </button>
          ))}
        </AdminToolbar>
        {data?.items?.length ? (
          <AdminTableWrap>
            <AdminTable>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>Session</th>
                  <th>分類</th>
                  <th>Reporter</th>
                  <th>Reported</th>
                  <th>狀態</th>
                  <th>標記</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.created_at)}</td>
                    <td>{item.random_session_id ? shortId(item.random_session_id) : "—"}</td>
                    <td>{item.category}</td>
                    <td>{shortId(item.reporter_id)}</td>
                    <td>{shortId(item.reported_user_id)}</td>
                    <td>{item.status}</td>
                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        {item.has_block ? <AdminBadge tone="danger">block</AdminBadge> : null}
                        {item.has_fraud_risk_event ? <AdminBadge tone="danger">fraud</AdminBadge> : null}
                        {item.session_status ? <AdminBadge tone="accent">{item.session_status}</AdminBadge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableWrap>
        ) : (
          <AdminEmpty>目前沒有 reports。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
