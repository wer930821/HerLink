"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminPaginationResult, AdminRealtimeDiagnosticRow } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, AdminToolbar, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

type RealtimePayload = AdminPaginationResult<AdminRealtimeDiagnosticRow>;

const eventTypeOptions = [
  "all",
  "realtime_subscribe_started",
  "realtime_subscribed",
  "realtime_subscribe_error",
  "realtime_disconnected",
  "realtime_reconnected",
  "message_received_realtime",
  "message_loaded_from_db",
] as const;

function realtimeEventLabel(value: (typeof eventTypeOptions)[number] | string) {
  const labels: Record<string, string> = {
    all: "全部事件",
    realtime_subscribe_started: "開始建立即時連線",
    realtime_subscribed: "即時連線成功",
    realtime_subscribe_error: "即時連線失敗",
    realtime_disconnected: "即時連線中斷",
    realtime_reconnected: "即時連線恢復",
    message_received_realtime: "即時收到訊息",
    message_loaded_from_db: "從資料庫載入訊息",
  };
  return labels[value] ?? value;
}

export default function AdminRealtimePage() {
  const { session, loading, accessToken } = useAdminSession();
  const [sessionId, setSessionId] = useState("");
  const [eventType, setEventType] = useState<(typeof eventTypeOptions)[number]>("all");
  const [data, setData] = useState<RealtimePayload | null>(null);
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
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (sessionId.trim()) params.set("sessionId", sessionId.trim());
      if (eventType !== "all") params.set("eventType", eventType);
      const result = await fetchAdminJson<RealtimePayload>(accessToken, `/api/admin/realtime?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入即時診斷。");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, eventType]);

  if (sessionState === "loading") {
    return <AdminEmpty>正在載入後台驗證…</AdminEmpty>;
  }

  if (sessionState !== "ready") {
    return <AdminEmpty>請先登入後再使用後台。</AdminEmpty>;
  }

  return (
    <div className="stack">
      <AdminSection
        title="即時診斷"
        description="查看聊天室即時連線與訊息事件，不顯示不必要的敏感資料。"
        action={
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <AdminToolbar>
          <input
            className="input"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder="聊天場次 ID 篩選"
          />
          <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value as (typeof eventTypeOptions)[number])}>
            {eventTypeOptions.map((item) => (
              <option key={item} value={item}>
                {realtimeEventLabel(item)}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
            套用
          </Button>
        </AdminToolbar>
        {data?.items?.length ? (
          <AdminTableWrap>
            <AdminTable label="即時診斷事件">
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">事件</th>
                  <th scope="col">場次</th>
                  <th scope="col">使用者</th>
                  <th scope="col">訊息</th>
                  <th scope="col">安全錯誤碼</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.created_at)}</td>
                    <td>
                      <AdminBadge tone={item.event_type === "realtime_subscribe_error" ? "danger" : item.event_type === "message_received_realtime" ? "accent" : "default"}>
                        {item.event_type}
                      </AdminBadge>
                    </td>
                    <td>{shortId(item.session_id)}</td>
                    <td>{shortId(item.user_id)}</td>
                    <td>{item.message_id ? shortId(item.message_id) : "—"}</td>
                    <td>{item.safe_error_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableWrap>
        ) : (
          <AdminEmpty>目前沒有即時診斷資料。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
