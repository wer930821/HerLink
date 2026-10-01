"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminSession, fetchAdminJson } from "../../../lib/admin-client";
import type { AdminFraudRiskEventRow, AdminModerationEnforcementRow } from "../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminStat, AdminStatGrid, AdminTable, AdminTableWrap, formatAdminTime, shortId } from "../_components";
import { Button, Notice } from "../../../components/ui";

function enforcementTypeLabel(value: string) {
  if (value === "temporary_suspension") return "暫時停權";
  if (value === "permanent_ban") return "永久停權";
  if (value === "warning") return "警告";
  return "其他處置";
}

function enforcementStatusLabel(value: string) {
  if (value === "active") return "生效中";
  if (value === "expired") return "已到期";
  if (value === "revoked") return "已撤銷";
  return "其他狀態";
}

function riskLevelLabel(value: string) {
  if (value === "critical") return "嚴重";
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return "其他等級";
}

function riskTypeLabel(value: string) {
  const labels: Record<string, string> = {
    scam: "詐騙",
    money_request: "索取金錢",
    investment: "投資",
    investment_scam: "投資詐騙",
    bank_account: "銀行帳戶",
    credit_card: "信用卡",
    verification_code: "驗證碼",
    otp: "驗證碼",
    crypto: "虛擬貨幣",
    external_link: "外部連結",
    impersonation: "冒名",
    spam: "垃圾訊息／廣告",
    harassment: "騷擾",
    threat: "威脅",
  };
  return labels[value] ?? "其他風險";
}

function enforcementReasonLabel(value: string | null) {
  if (!value) return "—";
  const labels: Record<string, string> = {
    report: "檢舉",
    repeated_reports: "多次被檢舉",
    fraud: "高風險內容",
    fraud_risk: "高風險內容",
    harassment: "騷擾",
    spam: "垃圾訊息／廣告",
    block: "封鎖事件",
    suspected_minor: "疑似未成年",
    manual: "管理員處置",
  };
  return labels[value] ?? "其他原因";
}

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
        title="安全管理"
        description="檢視審核、風險警示與目前有效的安全處置。"
        action={
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        {data ? (
          <div className="stack">
            <AdminStatGrid>
              <AdminStat label="有效暫時停權" value={data.stats.active_temporary_suspensions} tone="warning" />
              <AdminStat label="有效永久停權" value={data.stats.active_permanent_bans} tone="danger" />
              <AdminStat label="有效警告" value={data.stats.active_warnings} />
            </AdminStatGrid>

            <AdminSection title="安全處置紀錄">
              {data.moderation_enforcements.length ? (
                <AdminTableWrap>
                  <AdminTable label="安全處置紀錄">
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">使用者</th>
                        <th scope="col">處置類型</th>
                        <th scope="col">原因</th>
                        <th scope="col">狀態</th>
                        <th scope="col">到期時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.moderation_enforcements.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>{item.subject_user_id ? shortId(item.subject_user_id) : "—"}</td>
                          <td>{enforcementTypeLabel(item.enforcement_type)}</td>
                          <td>{enforcementReasonLabel(item.reason_code)}</td>
                          <td>
                            <AdminBadge tone={item.status === "active" ? "danger" : item.status === "expired" ? "warning" : "default"}>
                              {enforcementStatusLabel(item.status)}
                            </AdminBadge>
                          </td>
                          <td>{formatAdminTime(item.expires_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>目前沒有安全處置紀錄。</AdminEmpty>
              )}
            </AdminSection>

            <AdminSection title="風險警示紀錄">
              {data.fraud_risk_events.length ? (
                <AdminTableWrap>
                  <AdminTable label="風險警示紀錄">
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">等級</th>
                        <th scope="col">使用者</th>
                        <th scope="col">場次</th>
                        <th scope="col">風險類型</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.fraud_risk_events.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>
                            <AdminBadge tone={item.risk_level === "critical" ? "danger" : item.risk_level === "high" ? "warning" : "default"}>
                              {riskLevelLabel(item.risk_level)}
                            </AdminBadge>
                          </td>
                          <td>{shortId(item.user_id)}</td>
                          <td>{item.session_id ? shortId(item.session_id) : "—"}</td>
                          <td>{item.risk_types.map(riskTypeLabel).join("、") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>目前沒有風險警示紀錄。</AdminEmpty>
              )}
            </AdminSection>
          </div>
        ) : null}
      </AdminSection>
    </div>
  );
}
