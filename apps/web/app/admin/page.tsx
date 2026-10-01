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

function layaStateLabel(value: AdminSummary["laya_service_state"] | undefined) {
  if (value === "ready") return "正常";
  if (value === "loading") return "載入中";
  if (value === "error") return "異常";
  if (value === "unreachable") return "無法連線";
  return "—";
}

function errorSourceLabel(value: string) {
  if (value === "realtime") return "即時連線";
  if (value === "push") return "通知";
  if (value === "laya") return "聊天助手";
  return value;
}

function errorCodeLabel(value: string) {
  const labels: Record<string, string> = {
    CHANNEL_ERROR: "連線頻道錯誤",
    TIMED_OUT: "連線逾時",
    FALLBACK_USED: "聊天助手失敗，已使用備援回覆",
    revoked: "通知訂閱失效",
    failed: "通知發送失敗",
    UNKNOWN: "未知錯誤",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function shortVersion(value: string | null | undefined) {
  if (!value) return "—";
  return value.length > 10 ? value.slice(0, 10) : value;
}

export default function AdminDashboardPage() {
  const { session, loading, accessToken } = useAdminSession();
  const { onlineCount, onlineCountConnected } = useOnlinePresence(session?.user.id ?? null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

  const sessionState = useMemo(() => {
    if (loading) return "loading";
    if (!session) return "signed_out";
    if (!accessToken) return "missing_token";
    return "ready";
  }, [accessToken, loading, session]);

  const load = async (options: { silent?: boolean } = {}) => {
    if (!accessToken) return;
    if (!options.silent) setRefreshing(true);
    setError(null);
    try {
      const [summary, realtime] = await Promise.all([
        fetchAdminJson<AdminSummary>(accessToken, "/api/admin/summary", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetchAdminJson<{ items: AdminRealtimeDiagnosticRow[] }>(accessToken, "/api/admin/realtime?page=1&pageSize=8", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);
      setData({
        ...summary,
        recent_realtime_diagnostics: realtime.items ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入後台總覽。");
    } finally {
      if (!options.silent) setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !autoRefreshEnabled) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    };

    const interval = window.setInterval(refreshIfVisible, 30_000);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, autoRefreshEnabled]);

  const overallHealth = useMemo(() => {
    if (!data) {
      return { label: "檢查中", tone: "default" as const, reasons: ["正在取得最新健康資料"] };
    }

    const criticalReasons: string[] = [];
    const warningReasons: string[] = [];

    if (data.laya_service_state === "error") {
      criticalReasons.push("聊天助手服務回報異常");
    }
    if (data.laya_service_state === "unreachable") {
      criticalReasons.push("無法連線到聊天助手服務");
    }

    if (data.laya_service_state === "loading") {
      warningReasons.push("聊天助手模型仍在載入");
    }
    if (data.realtime_errors_5m > 0) {
      warningReasons.push(`近 5 分鐘有 ${data.realtime_errors_5m} 個 即時連線重試裝置`);
    }
    if (
      data.today_chat_assist_requests >= 3 &&
      typeof data.today_laya_success_rate === "number" &&
      data.today_laya_success_rate < 80
    ) {
      warningReasons.push(`今日聊天助手成功率為 ${data.today_laya_success_rate.toFixed(1)}%`);
    }
    if (typeof data.today_match_success_rate === "number" && data.today_match_success_rate < 50) {
      warningReasons.push(`今日配對成功率為 ${data.today_match_success_rate.toFixed(1)}%`);
    }
    if (typeof data.today_push_success_rate === "number" && data.today_push_success_rate < 95) {
      warningReasons.push(`今日通知成功率為 ${data.today_push_success_rate.toFixed(1)}%`);
    }
    if (typeof data.laya_health_latency_ms === "number" && data.laya_health_latency_ms > 1500) {
      warningReasons.push(`聊天助手回應延遲偏高（${data.laya_health_latency_ms} ms）`);
    }

    if (criticalReasons.length > 0) {
      return { label: "異常", tone: "danger" as const, reasons: criticalReasons };
    }

    if (warningReasons.length > 0) {
      return { label: "需注意", tone: "warning" as const, reasons: warningReasons };
    }

    return {
      label: "正常",
      tone: "success" as const,
      reasons: ["所有核心服務目前正常"],
    };
  }, [data]);

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
          <div className="row">
            <Button
              variant={autoRefreshEnabled ? "secondary" : "ghost"}
              size="sm"
              type="button"
              onClick={() => setAutoRefreshEnabled((enabled) => !enabled)}
            >
              {autoRefreshEnabled ? "自動更新：開" : "自動更新：關"}
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
              {refreshing ? "重新整理中…" : "一鍵重新整理"}
            </Button>
          </div>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <div style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <span className="muted small">系統狀態</span>
              <AdminBadge tone={overallHealth.tone}>{overallHealth.label}</AdminBadge>
            </div>
            <span className="muted small">
              最後更新：{data?.generated_at ? formatAdminTime(data.generated_at) : "—"}
            </span>
          </div>
          <div className="muted small" style={{ marginTop: 8, lineHeight: 1.6 }}>
            原因：{overallHealth.reasons.join("；")}
          </div>
        </div>
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

      <AdminSection title="部署資訊" description="確認目前正式環境正在執行哪一個版本，以及這個版本第一次通過健康檢查的時間。">
        <AdminStatGrid>
          <AdminStat label="部署版本" value={shortVersion(data?.deployment_version)} />
          <AdminStat label="部署分支" value={data?.deployment_branch === "main" ? "主要分支" : data?.deployment_branch ? "其他分支" : "—"} />
          <AdminStat label="部署環境" value={data?.deployment_environment === "production" ? "正式環境" : data?.deployment_environment ?? "—"} />
          <AdminStat
            label="最後成功部署時間"
            value={data?.last_successful_deployment_at ? formatAdminTime(data.last_successful_deployment_at) : "—"}
            tone={data?.last_successful_deployment_at ? "success" : "default"}
          />
        </AdminStatGrid>
        <div className="muted small" style={{ marginTop: 10, overflowWrap: "anywhere" }}>
          部署編號：{data?.deployment_id ?? "—"}
        </div>
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
            label="近 1 分鐘異常連線"
            value={formatCount(data?.realtime_errors_1m)}
            tone={(data?.realtime_errors_1m ?? 0) > 0 ? "warning" : "success"}
          />
          <AdminStat
            label="近 5 分鐘異常連線"
            value={formatCount(data?.realtime_errors_5m)}
            tone={(data?.realtime_errors_5m ?? 0) > 0 ? "warning" : "success"}
          />
          <AdminStat
            label="近 10 分鐘異常連線"
            value={formatCount(data?.realtime_errors_10m)}
            tone={(data?.realtime_errors_10m ?? 0) > 0 ? "warning" : "success"}
          />
          <AdminStat
            label="最近一次異常"
            value={data?.realtime_last_error_at ? formatAdminTime(data.realtime_last_error_at) : "—"}
            tone={(data?.realtime_errors_5m ?? 0) > 0 ? "warning" : "success"}
          />
          <AdminStat
            label="近 1 小時異常連線"
            value={formatCount(data?.realtime_errors_1h)}
            tone={(data?.realtime_errors_1h ?? 0) > 0 ? "warning" : "success"}
          />
          <AdminStat
            label="今日通知成功率"
            value={formatPercent(data?.today_push_success_rate)}
            tone={typeof data?.today_push_success_rate === "number" && data.today_push_success_rate < 95 ? "warning" : "success"}
          />
          <AdminStat
            label="聊天助手服務狀態"
            value={layaStateLabel(data?.laya_service_state)}
            tone={data?.laya_service_state === "ready" ? "success" : data?.laya_service_state === "loading" ? "warning" : "danger"}
          />
          <AdminStat
            label="聊天助手回應延遲"
            value={typeof data?.laya_health_latency_ms === "number" ? `${data.laya_health_latency_ms} 毫秒` : "—"}
            tone={typeof data?.laya_health_latency_ms === "number" && data.laya_health_latency_ms > 1500 ? "warning" : "default"}
          />
          <AdminStat
            label="今日聊天助手成功率"
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

      <AdminSection title="最近錯誤摘要" description="彙整最近 24 小時的即時連線、通知與聊天助手備援事件。">
        {data?.recent_error_summary?.length ? (
          <AdminTableWrap>
            <AdminTable label="最近錯誤摘要">
              <thead>
                <tr>
                  <th scope="col">來源</th>
                  <th scope="col">錯誤</th>
                  <th scope="col">次數</th>
                  <th scope="col">最近發生</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_error_summary.map((item, index) => (
                  <tr key={`${item.source}-${item.error_code}-${index}`}>
                    <td><AdminBadge tone="warning">{errorSourceLabel(item.source)}</AdminBadge></td>
                    <td>{errorCodeLabel(item.error_code)}</td>
                    <td>{formatCount(item.error_count)}</td>
                    <td>{formatAdminTime(item.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableWrap>
        ) : (
          <AdminEmpty>最近 24 小時沒有偵測到需要顯示的錯誤。</AdminEmpty>
        )}
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
                    <td>{errorCodeLabel(item.safe_error_code ?? "UNKNOWN")}</td>
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
