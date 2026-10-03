"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAdminSession, fetchAdminJson } from "../../../../lib/admin-client";
import type { AdminSessionDetail } from "../../../../lib/admin-types";
import { AdminBadge, AdminEmpty, AdminSection, AdminTable, AdminTableWrap, AdminToolbar, formatAdminTime, shortId } from "../../_components";
import { Button, Notice } from "../../../../components/ui";
import { adminRestoreRandomSessionToSelf } from "../../../../lib/supabase";

function sessionStatusLabel(value: string) {
  if (value === "waiting") return "等待中";
  if (value === "active") return "聊天中";
  if (value === "ended") return "已結束";
  return "聊天中";
}

function reportStatusLabel(value: string) {
  if (value === "open") return "待處理";
  if (value === "reviewing") return "處理中";
  if (value === "resolved") return "已處理";
  if (value === "dismissed") return "已忽略";
  return "其他狀態";
}

function riskLevelLabel(value: string) {
  if (value === "critical") return "嚴重";
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return "未分類";
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

function riskTypeLabel(value: string) {
  const labels: Record<string, string> = {
    suspicious_external_link: "可疑外部連結",
    repeated_message: "重複訊息",
    off_platform_contact: "要求站外聯絡",
    suspicious_money_message: "金錢／匯款相關",
    suspicious_investment_message: "投資相關",
    credential_request: "帳號／驗證資料要求",
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
  return labels[value] ?? `未分類（${value}）`;
}

function endedReasonLabel(value: string) {
  const labels: Record<string, string> = {
    left: "使用者離開",
    next: "切換下一位",
    blocked: "封鎖",
    timeout: "逾時結束",
    disconnected: "連線中斷",
    partner_left: "對方離開",
  };
  return labels[value] ?? "其他原因";
}

export default function AdminSessionDetailPage() {
  const { session, loading, accessToken } = useAdminSession();
  const params = useParams<{ id: string }>();
  const sessionId = params?.id ?? "";
  const [data, setData] = useState<AdminSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState<"a"|"b"|null>(null);
  const [targetWebUserId, setTargetWebUserId] = useState("");

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
      setError(err instanceof Error ? err.message : "無法載入聊天場次詳情。");
    } finally {
      setRefreshing(false);
    }
  };

  const restoreSide = async (side:"a"|"b") => {
    if (!data) return;
    setRestoreBusy(side);
    setError(null);
    const target = targetWebUserId.trim();
    if (!target) { setError("請先輸入目前匿名 Web 的完整使用者 ID。"); setRestoreBusy(null); return; }
    const result = await adminRestoreRandomSessionToSelf(sessionId, side, target);
    if (result.error) setError(result.error.message || "恢復失敗。");
    else window.location.assign("/");
    setRestoreBusy(null);
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
    return <AdminEmpty>缺少聊天場次編號。</AdminEmpty>;
  }

  return (
    <div className="stack">
      <AdminSection
        title="聊天場次詳情"
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
              <AdminBadge tone={data.status === "ended" ? "warning" : data.status === "active" ? "success" : "default"}>{sessionStatusLabel(data.status)}</AdminBadge>
              {data.ended_reason ? <AdminBadge tone="accent">結束原因：{endedReasonLabel(data.ended_reason)}</AdminBadge> : null}
              {data.ended_by ? <AdminBadge>結束者：{shortId(data.ended_by)}</AdminBadge> : null}
            </AdminToolbar>
            <AdminSection title="基本資訊">
              {data ? <div className="stack" style={{marginBottom:12}}><input value={targetWebUserId} onChange={(e)=>setTargetWebUserId(e.target.value)} placeholder="目前匿名 Web 的完整使用者 ID" style={{width:"100%",padding:"12px",borderRadius:10}}/><div className="row"><Button size="sm" type="button" disabled={restoreBusy!==null} onClick={()=>void restoreSide("a")}>{restoreBusy==="a"?"恢復中…":"恢復 A 方到這個 Web 身分"}</Button><Button size="sm" type="button" disabled={restoreBusy!==null} onClick={()=>void restoreSide("b")}>{restoreBusy==="b"?"恢復中…":"恢復 B 方到這個 Web 身分"}</Button></div></div> : null}
              <div className="admin-kv-grid">
                <div><span>建立時間</span><strong>{formatAdminTime(data.created_at)}</strong></div>
                <div><span>結束時間</span><strong>{formatAdminTime(data.ended_at)}</strong></div>
                <div><span>參與者</span><strong>{shortId(data.user_a)} / {shortId(data.user_b)}</strong></div>
                <div><span>訊息數</span><strong>{data.message_count}</strong></div>
              </div>
            </AdminSection>

            <AdminSection title="檢舉紀錄">
              {data.reports.length ? (
                <AdminTableWrap>
                  <AdminTable label="檢舉紀錄">
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">分類</th>
                        <th scope="col">檢舉者</th>
                        <th scope="col">被檢舉者</th>
                        <th scope="col">狀態</th>
                        <th scope="col">標記</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reports.map((item) => (
                        <tr key={item.id}>
                          <td>{formatAdminTime(item.created_at)}</td>
                          <td>{reportCategoryLabel(item.category)}</td>
                          <td>{shortId(item.reporter_id)}</td>
                          <td>{shortId(item.reported_user_id)}</td>
                          <td>{reportStatusLabel(item.status)}</td>
                          <td>
                            <div className="stack" style={{ gap: 6 }}>
                              {item.has_block ? <AdminBadge tone="danger">封鎖</AdminBadge> : null}
                              {item.has_fraud_risk_event ? <AdminBadge tone="danger">風險</AdminBadge> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </AdminTableWrap>
              ) : (
                <AdminEmpty>目前沒有檢舉紀錄。</AdminEmpty>
              )}
            </AdminSection>

            <AdminSection title="封鎖紀錄">
              {data.blocks.length ? (
                <AdminTableWrap>
                  <AdminTable label="封鎖紀錄">
                    <thead>
                      <tr>
                        <th scope="col">時間</th>
                        <th scope="col">封鎖者</th>
                        <th scope="col">被封鎖者</th>
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
                <AdminEmpty>目前沒有封鎖紀錄。</AdminEmpty>
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
                        <th scope="col">訊息</th>
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
                          <td>{item.message_id ? shortId(item.message_id) : "—"}</td>
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

            {data.messages?.length ? (
              <AdminSection title="聊天訊息" description="完整內容只給後台，不會出現在一般頁面。">
                <div className="admin-message-list">
                  {data.messages.map((message) => (
                    <article key={message.id} className="admin-message-item">
                      <div className="admin-message-meta">
                        <strong>{shortId(message.sender_id)}</strong>
                        <span>{formatAdminTime(message.created_at)}</span>
                      </div>
                      <div className="admin-message-body">{message.content}</div>
                    </article>
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
