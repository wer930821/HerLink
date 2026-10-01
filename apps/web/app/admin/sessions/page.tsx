"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminPaginationResult, AdminSessionListItem } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminToolbar, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

type SessionListPayload = AdminPaginationResult<AdminSessionListItem>;

const statusOptions = ["all", "waiting", "active", "ended"] as const;

function sessionStatusLabel(value: (typeof statusOptions)[number] | string) {
  if (value === "waiting") return "等待中";
  if (value === "active") return "聊天中";
  if (value === "ended") return "已結束";
  return value === "all" ? "全部" : "聊天中";
}

export default function AdminSessionsPage() {
  const { session, loading, accessToken } = useAdminSession();
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("all");
  const [data, setData] = useState<SessionListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);

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
      setError(err instanceof Error ? err.message : "無法載入聊天場次。");
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
        title="聊天場次"
        description="依狀態瀏覽聊天場次，點入可查看完整對話與安全事件。"
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
              {sessionStatusLabel(item)}
            </Button>
          ))}
        </AdminToolbar>
        {refreshing && !data ? (
          <div className="admin-session-loading" aria-live="polite">
            <span className="admin-session-loading-dot" />
            <span>正在載入聊天場次…</span>
          </div>
        ) : data?.items?.length ? (
          <div className="admin-session-list" aria-label="聊天場次列表">
            {data.items.map((item) => (
              <article key={item.id} className="admin-session-row">
                <div className="admin-session-main">
                  <div className="admin-session-id">{shortId(item.id)}</div>
                  <AdminBadge tone={item.status === "ended" ? "warning" : item.status === "active" ? "success" : "default"}>
                    {sessionStatusLabel(item.status)}
                  </AdminBadge>
                </div>

                <div className="admin-session-meta">
                  <div>
                    <span>訊息</span>
                    <strong>{item.message_count}</strong>
                  </div>
                  <div>
                    <span>最後訊息</span>
                    <strong>{formatAdminTime(item.last_message_at)}</strong>
                  </div>
                </div>

                <div className="admin-session-bottom">
                  <div className="admin-session-flags">
                    {item.has_report ? <AdminBadge tone="warning">檢舉</AdminBadge> : null}
                    {item.has_block ? <AdminBadge tone="danger">封鎖</AdminBadge> : null}
                    {item.has_fraud_risk_event ? <AdminBadge tone="danger">風險</AdminBadge> : null}
                    {!item.has_report && !item.has_block && !item.has_fraud_risk_event ? <span className="muted small">無標記</span> : null}
                  </div>
                  <Button variant="link" size="sm" href={`/admin/sessions/${item.id}`}>查看內容</Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <AdminEmpty>目前沒有符合條件的聊天場次。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
