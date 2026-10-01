"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminPaginationResult, AdminReportListItem } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, AdminToolbar, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

type ReportPayload = AdminPaginationResult<AdminReportListItem>;

const statusOptions = ["all", "open", "reviewing", "resolved", "dismissed"] as const;

function reportStatusLabel(value: (typeof statusOptions)[number] | string) {
  if (value === "open") return "待處理";
  if (value === "reviewing") return "處理中";
  if (value === "resolved") return "已處理";
  if (value === "dismissed") return "已忽略";
  return value === "all" ? "全部" : "其他狀態";
}

function reportCategoryLabel(value: string) {
  const labels: Record<string, string> = {
    spam: "垃圾訊息／廣告",
    scam: "詐騙",
    money_request: "索取金錢",
    investment_scam: "投資詐騙",
    harassment: "騷擾",
    sexual_content: "露骨內容",
    threat: "威脅",
    impersonation: "冒名",
    suspected_minor: "疑似未成年",
    other: "其他",
  };
  return labels[value] ?? "其他";
}

function sessionStatusLabel(value: string) {
  if (value === "waiting") return "等待中";
  if (value === "matched") return "聊天中";
  if (value === "active") return "聊天中";
  if (value === "ended") return "已結束";
  return "其他狀態";
}

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
      setError(err instanceof Error ? err.message : "無法載入檢舉資料。");
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
        title="檢舉管理"
        description="依狀態檢視檢舉資料與關聯聊天場次。"
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
              {reportStatusLabel(item)}
            </Button>
          ))}
        </AdminToolbar>
        {data?.items?.length ? (
          <AdminTableWrap>
            <AdminTable label="檢舉列表">
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">場次</th>
                  <th scope="col">分類</th>
                  <th scope="col">檢舉者</th>
                  <th scope="col">被檢舉者</th>
                  <th scope="col">狀態</th>
                  <th scope="col">標記</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatAdminTime(item.created_at)}</td>
                    <td>{item.random_session_id ? shortId(item.random_session_id) : "—"}</td>
                    <td>{reportCategoryLabel(item.category)}</td>
                    <td>{shortId(item.reporter_id)}</td>
                    <td>{shortId(item.reported_user_id)}</td>
                    <td>{reportStatusLabel(item.status)}</td>
                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        {item.has_block ? <AdminBadge tone="danger">封鎖</AdminBadge> : null}
                        {item.has_fraud_risk_event ? <AdminBadge tone="danger">風險</AdminBadge> : null}
                        {item.session_status ? <AdminBadge tone="accent">{sessionStatusLabel(item.session_status)}</AdminBadge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableWrap>
        ) : (
          <AdminEmpty>目前沒有檢舉資料。</AdminEmpty>
        )}
      </AdminSection>
    </div>
  );
}
