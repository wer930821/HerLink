"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getCurrentSession,
  listMyAnonymousContacts,
  removeAnonymousContact,
  requestAnonymousContact,
  startAnonymousContactSession,
  type AnonymousContactRow,
} from "../../lib/supabase";
import { Badge, Button, Notice, PageHero, Surface } from "../../components/ui";

function friendlyContactError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  if (message.includes("already have an active anonymous chat")) return "你目前已有進行中的匿名聊天室。";
  if (message.includes("currently in another chat")) return "對方目前正在其他匿名聊天室中。";
  if (message.includes("not active")) return "這位匿名聯絡人目前不可用。";
  return "目前無法完成操作，請稍後再試。";
}

export default function AnonymousContactsPage() {
  const router = useRouter();
  const [items, setItems] = useState<AnonymousContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const { data: authData } = await getCurrentSession();
      if (!authData.session) {
        router.replace("/");
        return;
      }

      const result = await listMyAnonymousContacts();
      if (result.error) throw result.error;
      setItems(result.data ?? []);
    } catch {
      setNotice("無法載入匿名聯絡人，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (item: AnonymousContactRow) => {
    if (!item.source_session_id) return;
    setBusyId(item.contact_id);
    try {
      const result = await requestAnonymousContact(item.source_session_id);
      if (result.error) throw result.error;
      setNotice(result.data?.status === "active" ? "已接受，現在是匿名聯絡人。" : "已送出同意。");
      await load();
    } catch (error) {
      setNotice(friendlyContactError(error));
    } finally {
      setBusyId(null);
    }
  };

  const startChat = async (item: AnonymousContactRow) => {
    setBusyId(item.contact_id);
    setNotice(null);
    try {
      const result = await startAnonymousContactSession(item.contact_id);
      if (result.error) throw result.error;
      if (!result.data?.session_id) throw new Error("Missing session");
      router.push(`/session/${result.data.session_id}`);
    } catch (error) {
      setNotice(friendlyContactError(error));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: AnonymousContactRow) => {
    if (!window.confirm(`確定要移除「${item.partner_anonymous_display_name}」嗎？`)) return;
    setBusyId(item.contact_id);
    try {
      const result = await removeAnonymousContact(item.contact_id);
      if (result.error) throw result.error;
      setItems((current) => current.filter((entry) => entry.contact_id !== item.contact_id));
      setNotice("已移除匿名聯絡人。");
    } catch {
      setNotice("目前無法移除，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="stack">
      <PageHero
        eyebrow="HerLink"
        title="匿名聯絡人"
        copy="只有雙方都同意才會保留聯絡；不會公開真實姓名、帳號或其他個人資料。"
      >
        <div className="row">
          <Button variant="secondary" href="/">返回首頁</Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>重新整理</Button>
        </div>
      </PageHero>

      {notice ? <Notice variant="info">{notice}</Notice> : null}

      <Surface elevation={1}>
        {loading ? (
          <div className="muted">載入中…</div>
        ) : items.length === 0 ? (
          <>
            <div className="title">目前沒有匿名聯絡人</div>
            <p className="hero-copy">在匿名聊天室中點「保留匿名聯絡」，對方也同意後就會出現在這裡。</p>
          </>
        ) : (
          <div className="stack">
            {items.map((item) => {
              const busy = busyId === item.contact_id;
              const incoming = item.status === "pending" && item.partner_approved && !item.my_approved;
              const outgoing = item.status === "pending" && item.my_approved && !item.partner_approved;

              return (
                <Surface key={item.contact_id} elevation="inset">
                  <div className="row">
                    <strong>{item.partner_anonymous_display_name}</strong>
                    {item.partner_verified ? <Badge variant="success">已驗證</Badge> : null}
                    {item.status === "active" ? (
                      <Badge variant="accent">已互相保留</Badge>
                    ) : incoming ? (
                      <Badge variant="warning">等待你同意</Badge>
                    ) : outgoing ? (
                      <Badge>等待對方同意</Badge>
                    ) : null}
                  </div>
                  <div className="row">
                    {item.status === "active" ? (
                      <Button onClick={() => void startChat(item)} disabled={busy}>
                        {busy ? "處理中…" : "開始聊天"}
                      </Button>
                    ) : incoming && item.source_session_id ? (
                      <Button onClick={() => void accept(item)} disabled={busy}>
                        {busy ? "處理中…" : "接受匿名聯絡"}
                      </Button>
                    ) : null}
                    <Button variant="danger" onClick={() => void remove(item)} disabled={busy}>移除</Button>
                  </div>
                </Surface>
              );
            })}
          </div>
        )}
      </Surface>
    </main>
  );
}
