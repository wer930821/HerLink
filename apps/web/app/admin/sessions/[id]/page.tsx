"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAdminSession, fetchAdminJson } from "../../../../lib/admin-client";
import type { AdminSessionDetail } from "../../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, AdminToolbar, formatAdminTime, shortId } from "../../_components";
import { Button, Notice } from "../../../../components/ui";

export default function AdminSessionDetailPage() {
  const { session, loading, accessToken } = useAdminSession();
  const params = useParams<{ id: string }>();
  const sessionId = params?.id ?? "";
  const [data, setData] = useState<AdminSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const sessionState = useMemo(() => {
    if (loading) return "loading";
    if (!session) return "signed_out";
    if (!accessToken) return "missing_token";
    return "ready";
  }, [accessToken, loading, session]);

  const load = async () => {
    if (!accessToken || !sessionId) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await fetchAdminJson<AdminSessionDetail>(accessToken, `/api/admin/sessions/${sessionId}?includeMessages=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入 session 詳情。");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, sessionId]);

  if (sessionState === "loading") {
    return <AdminEmpty>正在載入後台驗證…</AdminEmpty>;
  }

  if (sessionState !== "ready") {
    return <AdminEmpty>請先登入後再使用後台。</AdminEmpty>;
  }

  if (!sessionId) {
    return <AdminEmpty>缺少 session id。</AdminEmpty>;
  }

  return (
    <div className="stack">
      <AdminSection
        title="Session 詳情"
        description={shortId(sessionId, 12)}
        action={
          <div className="row">
            <Button variant="secondary" size="sm" href="/admin/sessions">返回列表</Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => void load()} disabled={refreshing}>
              {refreshing ? "重新整理中…" : "重新整理"}
            </Button>
          </div>
        }
      >
        {error ? <Notice variant="danger">{error}</Notice> : null}
        {!data ? (
          <AdminEmpty>目前沒有資料。</AdminEmpty>
        ) : (
          <div className="stack">
            <AdminToolbar>
              <AdminBadge tone={data.status === "ended" ? "warning" : data.status === "matched" ? "success" : "default"}>{data.status}</AdminBadge>
              {data.ended_reason ? <AdminBadge tone="accent">reason: {data.ended_reason}</AdminBadge> : null}
              {data.ended_by ? <AdminBadge>ended by {shortId(data.ended_by)}</AdminBadge> : null}
            </AdminToolbar>
            <AdminSection title="基本資訊">
              <div className="admin-kv-grid">
                <div><span>建立時間</span><strong>{formatAdminTime(data.created_at)}</strong></div>
                <div><span>結束時間</span><strong>{formatAdminTime(data.ended_at)}</strong></div>
                <div><span>參與者</span><strong>{shortId(data.user_a)} / {shortId(data.user_b)}</strong></div>
                <div><span>訊息數</span><strong>{data.message_count}</strong></div>
              </div>
            </AdminSection>

            <AdminSection title="Reports">
              {data.reports.length ? (
                <AdminTableWrap>
                  <AdminTable>
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">Category</th>
                        <th scope="col">Reporter</th>
                        <th scope="col">Reported</th>
                        <th scope="col">狀態</th>
                        <th scope="col">標記</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reports.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>{item.category}</td>
                          <td>{shortId(item.reporter_id)}</td>
                          <td>{shortId(item.reported_user_id)}</td>
                          <td>{item.status}</td>
                          <td>
                            <div className="stack" style={{ gap: 6 }}>
                              {item.has_block ? <AdminBadge tone="danger">block</AdminBadge> : null}
                              {item.has_fraud_risk_event ? <AdminBadge tone="danger">fraud</AdminBadge> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>沒有 reports。</AdminEmpty>
              )}
            </AdminSection>

            <AdminSection title="Blocks">
              {data.blocks.length ? (
                <AdminTableWrap>
                  <AdminTable>
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">Blocker</th>
                        <th scope="col">Blocked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.blocks.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>{shortId(item.blocker_id)}</td>
                          <td>{shortId(item.blocked_user_id)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>沒有 blocks。</AdminEmpty>
              )}
            </AdminSection>

            <AdminSection title="Fraud risk events">
              {data.fraud_risk_events.length ? (
                <AdminTableWrap>
                  <AdminTable>
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">等級</th>
                        <th scope="col">User</th>
                        <th scope="col">Message</th>
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
                          <td>{item.message_id ? shortId(item.message_id) : "—"}</td>
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

            {data.messages?.length ? (
              <AdminSection title="Messages" description="完整內容只給後台，不會出現在一般頁面。">
                <div className="stack">
                  {data.messages.map((message) => (
                    <div key={message.id} className="notice">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <strong>{shortId(message.sender_id)}</strong>
                        <span className="muted">{formatAdminTime(message.created_at)}</span>
                      </div>
                      <div className="admin-message-body">{message.content}</div>
                    </div>
                  ))}
                </div>
              </AdminSection>
            ) : null}
          </div>
        )}
      </AdminSection>
    </div>
  );
}
