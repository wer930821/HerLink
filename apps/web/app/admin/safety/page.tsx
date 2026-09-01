"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminFraudRiskEventRow, AdminModerationEnforcementRow } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

type SafetyPayload = {
  moderation_enforcements: AdminModerationEnforcementRow[];
  fraud_risk_events: AdminFraudRiskEventRow[];
  stats: {
    active_temporary_suspensions: number;
    active_permanent_bans: number;
    active_warnings: number;
  };
};

export default function AdminSafetyPage() {
  const { session, loading, accessToken } = useAdminSession();
  const [data, setData] = useState<SafetyPayload | null>(null);
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
      const result = await fetchAdminJson<SafetyPayload>(accessToken, "/api/admin/safety?page=1&pageSize=50", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入安全資料。");
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
    return <AdminEmpty>請先登入後再使用後台。</AdminEmpty>;
  }

  return (
    <div className="stack">
      <AdminSection
        title="Safety"
        description="檢視 moderation / fraud 事件與目前有效的安全處置。"
        action={
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        {data ? (
          <div className="stack">
            <div className="admin-stat-grid">
              <div className="admin-stat admin-stat-warning">
                <div className="admin-stat-label">有效 temporary suspension</div>
                <div className="admin-stat-value">{data.stats.active_temporary_suspensions}</div>
              </div>
              <div className="admin-stat admin-stat-danger">
                <div className="admin-stat-label">有效 permanent ban</div>
                <div className="admin-stat-value">{data.stats.active_permanent_bans}</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat-label">有效 warnings</div>
                <div className="admin-stat-value">{data.stats.active_warnings}</div>
              </div>
            </div>

            <AdminSection title="Moderation enforcements">
              {data.moderation_enforcements.length ? (
                <AdminTableWrap>
                  <AdminTable>
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">Subject</th>
                        <th scope="col">Type</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Status</th>
                        <th scope="col">Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.moderation_enforcements.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>{item.subject_user_id ? shortId(item.subject_user_id) : "—"}</td>
                          <td>{item.enforcement_type}</td>
                          <td>{item.reason_code ?? "—"}</td>
                          <td>
                            <AdminBadge tone={item.status === "active" ? "danger" : item.status === "expired" ? "warning" : "default"}>
                              {item.status}
                            </AdminBadge>
                          </td>
                          <td>{formatAdminTime(item.expires_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>沒有 moderation enforcements。</AdminEmpty>
              )}
            </AdminSection>

            <AdminSection title="Fraud risk events">
              {data.fraud_risk_events.length ? (
                <AdminTableWrap>
                  <AdminTable>
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">Level</th>
                        <th scope="col">User</th>
                        <th scope="col">Session</th>
                        <th scope="col">Types</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.fraud_risk_events.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>
                            <AdminBadge tone={item.risk_level === "critical" ? "danger" : item.risk_level === "high" ? "warning" : "default"}>
                              {item.risk_level}
                            </AdminBadge>
                          </td>
                          <td>{shortId(item.user_id)}</td>
                          <td>{item.session_id ? shortId(item.session_id) : "—"}</td>
                          <td>{item.risk_types.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>沒有 fraud events。</AdminEmpty>
              )}
            </AdminSection>
          </div>
        ) : null}
      </AdminSection>
    </div>
  );
}
