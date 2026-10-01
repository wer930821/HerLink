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

function realtimeEventLabel(value: string) {
  const labels: Record<string, string> = {
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

function formatCount(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString("zh-TW") : "—";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "—";
}

function formatWait(value: number | null | undefined) {
  if (typeof value !== "number") return "—";
  if (value < 60) return `${Math.round(value)} 秒`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes} 分 ${seconds} 秒`;
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
          <AdminStat label="今日匿名使用者" value={formatCount(data?.today_anonymous_user_count)} />
          <AdminStat label="今日訊息" value={formatCount(data?.today_message_count)} />
          <AdminStat label="今日建立聊天場次" value={formatCount(data?.today_created_session_count)} />
          <AdminStat label="今日進入佇列" value={formatCount(data?.today_queue_join_count)} />
          <AdminStat label="今日結束聊天場次" value={formatCount(data?.today_ended_session_count)} />
          <AdminStat label="今日檢舉" value={formatCount(data?.today_report_count)} tone="warning" />
          <AdminStat label="今日封鎖" value={formatCount(data?.today_block_count)} tone="warning" />
          <AdminStat label="今日風險警示" value={formatCount(data?.today_fraud_risk_event_count)} tone="danger" />
          <AdminStat label="網頁通知訂閱" value={formatCount(data?.active_push_subscription_count)} />
          <AdminStat label="待發送通知" value={formatCount(data?.pending_push_event_count)} />
          <AdminStat label="今日通知成功" value={formatCount(data?.today_web_push_delivered_count)} tone="success" />
          <AdminStat label="今日通知失效" value={formatCount(data?.today_web_push_revoked_count)} tone="warning" />
        </AdminStatGrid>
      </AdminSection>

      <AdminSection title="系統健康狀態" description="快速確認配對、即時連線、通知與聊天助手是否正常；異常連線以受影響裝置去重計算。">
        <AdminStatGrid>
          <AdminStat
            label="今日配對成功率"
            value={formatPercent(data?.today_match_success_rate)}
            tone={typeof data?.today_match_success_rate === "number" && data.today_match_success_rate < 50 ? "warning" : "success"}
          />
          <AdminStat
            label="今日平均等待時間"
            value={formatWait(data?.today_avg_wait_seconds)}
            tone={typeof data?.today_avg_wait_seconds === "number" && data.today_avg_wait_seconds > 120 ? "warning" : "default"}
          />
          <AdminStat
            label="近 1 小時異常連線"
            value={formatCount(data?.realtime_errors_1h)}
            tone={(data?.realtime_errors_1h ?? 0) > 0 ? "danger" : "success"}
          />
          <AdminStat
            label="今日通知成功率"
            value={formatPercent(data?.today_push_success_rate)}
            tone={typeof data?.today_push_success_rate === "number" && data.today_push_success_rate < 95 ? "warning" : "success"}
          />
          <AdminStat
            label="今日 Laya 成功率"
            value={formatPercent(data?.today_laya_success_rate)}
            tone={typeof data?.today_laya_success_rate === "number" && data.today_laya_success_rate < 80 ? "warning" : "success"}
          />
          <AdminStat
            label="今日聊天助手使用次數"
            value={formatCount(data?.today_chat_assist_requests)}
          />
        </AdminStatGrid>
      </AdminSection>

      <AdminSection title="近 7 天匿名聊天室" description="最近 7×24 小時的實際匿名聊天活動。">
        <AdminStatGrid>
          <AdminStat label="使用者數" value={formatCount(data?.seven_day_anonymous_user_count)} />
          <AdminStat label="訊息數" value={formatCount(data?.seven_day_message_count)} />
          <AdminStat label="配對場次" value={formatCount(data?.seven_day_session_count)} />
          <AdminStat label="進入佇列" value={formatCount(data?.seven_day_queue_join_count)} />
        </AdminStatGrid>
      </AdminSection>

      <AdminSection title="最近即時診斷" description="僅保留安全事件與連線診斷，不含訊息正文。">
        {data?.recent_realtime_diagnostics?.length ? (
          <AdminTableWrap>
            <AdminTable label="最近即時診斷">
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">事件</th>
                  <th scope="col">場次</th>
                  <th scope="col">訊息</th>
                  <th scope="col">安全錯誤碼</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_realtime_diagnostics.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.created_at)}</td>
                    <td>
                      <AdminBadge tone={item.event_type === "realtime_subscribe_error" ? "danger" : item.event_type === "message_received_realtime" ? "accent" : "default"}>
                        {realtimeEventLabel(item.event_type)}
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
          <AdminEmpty>目前沒有即時診斷資料。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
