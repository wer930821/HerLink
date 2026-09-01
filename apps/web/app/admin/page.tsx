"use client";

import { useEffect, useMemo, useState } from "react";
import { useOnlinePresence } from "../../lib/realtime-presence";
import { fetchAdminJson, useAdminSession } from "../../lib/admin-client";
import type { AdminRealtimeDiagnosticRow, AdminSummary } from "../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminStat, AdminStatGrid, AdminTable, AdminTableWrap, formatAdminTime, shortId } from "./_components";
import { Button, Notice } from "../../components/ui";

type DashboardPayload = AdminSummary & {
  recent_realtime_diagnostics: AdminRealtimeDiagnosticRow[];
};

function formatCount(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString("zh-TW") : "—";
}

export default function AdminDashboardPage() {
  const { session, loading, accessToken } = useAdminSession();
  const { onlineCount, onlineCountConnected } = useOnlinePresence(session?.user.id ?? null);
  const [data, setData] = useState<DashboardPayload | null>(null);
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
      const summary = await fetchAdminJson<AdminSummary>(accessToken, "/api/admin/summary", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const realtime = await fetchAdminJson<{ items: AdminRealtimeDiagnosticRow[] }>(accessToken, "/api/admin/realtime?page=1&pageSize=8", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData({
        ...summary,
        recent_realtime_diagnostics: realtime.items ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入後台總覽。");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  if (sessionState === "loading") {
    return <AdminEmpty>正在載入後台驗證…</AdminEmpty>;
  }

  if (sessionState !== "ready") {
    return (
      <AdminSection title="需要登入" description="先以 HerLink 帳號登入，再開啟後台。">
        <AdminEmpty>
          <p className="muted">請先登入後再使用後台。</p>
          <Button variant="secondary" href="/login">前往登入</Button>
        </AdminEmpty>
      </AdminSection>
    );
  }

  return (
    <div className="stack">
      <AdminSection
        title="總覽"
        description="目前在線、等待池、活躍對話與今日安全事件的即時摘要。"
        action={
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <AdminStatGrid>
          <AdminStat label="目前在線" value={onlineCount === null ? "—" : `${onlineCount} 人`} tone={onlineCountConnected ? "success" : "default"} />
          <AdminStat label="等待中" value={formatCount(data?.waiting_count)} />
          <AdminStat label="活躍對話" value={formatCount(data?.active_session_count)} />
          <AdminStat label="今日建立 sessions" value={formatCount(data?.today_created_session_count)} />
          <AdminStat label="今日訊息" value={formatCount(data?.today_message_count)} />
          <AdminStat label="今日結束 sessions" value={formatCount(data?.today_ended_session_count)} />
          <AdminStat label="今日檢舉" value={formatCount(data?.today_report_count)} tone="warning" />
          <AdminStat label="今日封鎖" value={formatCount(data?.today_block_count)} tone="warning" />
          <AdminStat label="今日 fraud events" value={formatCount(data?.today_fraud_risk_event_count)} tone="danger" />
        </AdminStatGrid>
      </AdminSection>

      <AdminSection title="最近 Realtime 診斷" description="僅保留安全事件與連線診斷，不含訊息正文。">
        {data?.recent_realtime_diagnostics?.length ? (
          <AdminTableWrap>
            <AdminTable label="最近 Realtime 診斷">
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">事件</th>
                  <th scope="col">Session</th>
                  <th scope="col">Message</th>
                  <th scope="col">Safe code</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_realtime_diagnostics.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.created_at)}</td>
                    <td>
                      <AdminBadge tone={item.event_type === "realtime_subscribe_error" ? "danger" : item.event_type === "message_received_realtime" ? "accent" : "default"}>
                        {item.event_type}
                      </AdminBadge>
                    </td>
                    <td>{shortId(item.session_id)}</td>
                    <td>{item.message_id ? shortId(item.message_id) : "—"}</td>
                    <td>{item.safe_error_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableWrap>
        ) : (
          <AdminEmpty>目前沒有 realtime 診斷資料。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
