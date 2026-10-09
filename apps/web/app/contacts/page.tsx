"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getCurrentSession,
  listMyAnonymousContacts,
  removeAnonymousContact,
  requestAnonymousContact,
  startAnonymousContactSession,
  supabase,
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
  const userIdRef = useRef<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: authData } = await getCurrentSession();
      if (!authData.session) {
        router.replace("/");
        return;
      }

      userIdRef.current = authData.session.user.id;
      const result = await listMyAnonymousContacts();
      if (result.error) throw result.error;
      setItems(result.data ?? []);
    } catch {
      if (!silent) setNotice("無法載入匿名聯絡人，請稍後再試。");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyPosition: body.style.position,
      bodyTouchAction: body.style.touchAction,
    };
    html.style.overflow = "auto";
    html.style.height = "auto";
    body.style.overflow = "auto";
    body.style.height = "auto";
    body.style.position = "static";
    body.style.touchAction = "pan-y";
    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.height = previous.htmlHeight;
      body.style.overflow = previous.bodyOverflow;
      body.style.height = previous.bodyHeight;
      body.style.position = previous.bodyPosition;
      body.style.touchAction = previous.bodyTouchAction;
    };
  }, []);

  useEffect(() => {
    const channel = supabase.channel("anonymous-contacts-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "random_chat_messages" }, (payload: { new: { sender_id?: string } }) => {
        void load(true);
        if (payload.new?.sender_id && payload.new.sender_id !== userIdRef.current && typeof document !== "undefined" && document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("HerLink 有新訊息", { body: "匿名聯絡人傳來新訊息，點開 HerLink 查看。" });
        }
      })
      .subscribe();
    const timer = window.setInterval(() => void load(true), 30000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") { setNotice("這個瀏覽器不支援通知。"); return; }
    const permission = await Notification.requestPermission();
    setNotice(permission === "granted" ? "新訊息通知已開啟。" : "通知未開啟，你仍可在聯絡人列表查看未讀訊息。");
  };

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

  const openPendingMessage = (item: AnonymousContactRow) => {
    // Pending retained contacts must reopen the original room. A current_session_id
    // can point at a later/ended room for the same pair, while source_session_id is
    // the room that created this retained-contact relationship and contains the
    // unread message shown on this card.
    const sessionId = item.source_session_id ?? item.current_session_id;
    if (!sessionId) {
      setNotice("找不到原聊天室，請重新整理後再試。");
      return;
    }
    setBusyId(item.contact_id);
    setNotice(null);
    // SessionReadTracker marks the room read after navigation, avoiding a duplicate RPC.
    window.location.assign(`/session/${encodeURIComponent(sessionId)}`);
  };

  const recoverChat = async (item: AnonymousContactRow) => {
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
    <main className="stack halloween-contacts-page">
      <div className="halloween-contacts-decor" aria-hidden="true"><span className="contacts-moon">☾</span><span className="contacts-stars">✦ · ✧ · ✦</span><span className="contacts-cat">🐈‍⬛</span><span className="contacts-candle">🕯️</span><span className="contacts-bat">🦇</span></div>
      <PageHero
        kicker="HerLink"
        title="匿名聯絡人"
        description="已保留的聯絡人可以各自繼續聊天；切換聊天室不會中斷其他對話。"
      >
        <div className="row">
          <Button variant="secondary" href="/">返回首頁</Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>重新整理</Button>
          {typeof Notification !== "undefined" && Notification.permission !== "granted" ? <Button variant="secondary" onClick={() => void enableNotifications()}>開啟新訊息通知</Button> : null}
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
              const hasPendingReply = item.status === "pending" && item.unread_count > 0 && Boolean(item.source_session_id ?? item.current_session_id);

              return (
                <Surface key={item.contact_id} elevation="inset" className="anonymous-contact-card">
                  <div className="row anonymous-contact-card-head">
                    <strong>{item.partner_anonymous_display_name}</strong>
                    {item.unread_count > 0 ? <Badge variant="warning">{item.unread_count > 99 ? "99+" : item.unread_count} 則未讀</Badge> : null}
                    {item.partner_verified ? <Badge variant="success">已驗證</Badge> : null}
                    {item.status === "active" ? (
                      <Badge variant="accent">已互相保留</Badge>
                    ) : incoming ? (
                      <Badge variant="warning">等待你同意</Badge>
                    ) : outgoing ? (
                      <Badge>等待對方同意</Badge>
                    ) : null}
                  </div>
                  {item.last_message_preview ? <div className="muted">{item.last_message_preview}</div> : null}
                  <div className="row anonymous-contact-card-actions">
                    {item.status === "active" ? (
                      <>
                        <Button onClick={() => void startChat(item)} disabled={busy}>
                          {busy ? "處理中…" : item.unread_count > 0 ? "查看新訊息" : "進入聊天室"}
                        </Button>
                        <Button variant="secondary" onClick={() => void recoverChat(item)} disabled={busy}>
                          {busy ? "處理中…" : "聊天室不見了？"}
                        </Button>
                      </>
                    ) : hasPendingReply ? (
                      <Button onClick={() => openPendingMessage(item)} disabled={busy}>
                        {busy ? "處理中…" : "查看新訊息"}
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

      <style jsx global>{`
        .halloween-contacts-decor,
        .halloween-contacts-decor * {
          pointer-events: none !important;
        }
        body:has(.halloween-contacts-page) {
          overflow-x: hidden !important;
          overflow-y: auto !important;
          height: auto !important;
          min-height: 100dvh !important;
          touch-action: pan-y !important;
          -webkit-overflow-scrolling: touch;
        }
        body:has(.halloween-contacts-page) .shell,
        body:has(.halloween-contacts-page) .container,
        .halloween-contacts-page {
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          touch-action: pan-y !important;
        }
        .halloween-contacts-page .anonymous-contact-card,
        .halloween-contacts-page .anonymous-contact-card-actions,
        .halloween-contacts-page .button {
          position: relative;
          pointer-events: auto !important;
        }
        .halloween-contacts-page .anonymous-contact-card-actions,
        .halloween-contacts-page .button {
          z-index: 5;
        }
      `}</style>
    </main>
  );
}
