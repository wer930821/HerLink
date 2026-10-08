"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "../../components/ui";
import { getCurrentSession, loadMyActiveRandomSessions, loadRandomMessages, type RandomChatMessageRow, type RandomSessionRow } from "../../lib/supabase";

export default function ChatsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<RandomSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestMessages, setLatestMessages] = useState<Record<string, RandomChatMessageRow | null>>({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      const auth = await getCurrentSession();
      if (!auth.data.session) {
        router.replace("/");
        return;
      }
      const result = await loadMyActiveRandomSessions();
      if (mounted) {
        const activeSessions = result.data ?? [];
        setSessions(activeSessions);
        const latestEntries = await Promise.all(activeSessions.map(async (chatSession) => {
          const messages = await loadRandomMessages(chatSession.id, 1);
          return [chatSession.id, messages.data?.[0] ?? null] as const;
        }));
        if (mounted) {
          setLatestMessages(Object.fromEntries(latestEntries));
          setLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [router]);

  return (
    <main className="stack home-premium" style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      <div>
        <p className="muted small">最多同時保留 3 個聊天室</p>
        <h1>我的聊天</h1>
      </div>
      {loading ? <p className="muted">載入中…</p> : null}
      {!loading && sessions.length === 0 ? (
        <Notice title="目前沒有進行中的聊天室">
          <div className="chats-empty-help">
            <p>如果你是第一次使用，可以回首頁開始匿名配對。</p>
            <p>如果你是換瀏覽器、換裝置，或清除過瀏覽資料，請先登入原本綁定的帳號；沒有綁定帳號時，回首頁使用「永久恢復碼」或「找回聊天室」。</p>
            <div>
              <Button href="/" variant="secondary" size="sm">回首頁恢復</Button>
              <Button href="/login" variant="ghost" size="sm">登入帳號</Button>
              <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>重新整理</Button>
            </div>
          </div>
        </Notice>
      ) : null}
      <div className="stack">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => router.push(`/session/${session.id}`)}
            style={{ width: "100%", textAlign: "left", padding: 16, borderRadius: 18, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)", color: "inherit" }}
          >
            <strong>{session.partner_anonymous_display_name || "匿名使用者"}</strong>
            {latestMessages[session.id] ? (
              <div className="muted small" style={{ marginTop: 6 }}>
                <strong style={{ color: latestMessages[session.id]?.is_mine ? "inherit" : "var(--color-accent-strong)" }}>
                  {latestMessages[session.id]?.is_mine ? "你：" : (session.partner_anonymous_display_name || "對方") + "："}
                </strong>
                {latestMessages[session.id]?.message_type === "image" ? "傳送了一張圖片" : latestMessages[session.id]?.content || "聊天中"}
              </div>
            ) : (
              <div className="muted small" style={{ marginTop: 6 }}>尚無訊息 · 點擊開始聊天</div>
            )}
          </button>
        ))}
      </div>
      <Button href="/" variant="secondary">回首頁</Button>
    </main>
  );
}
