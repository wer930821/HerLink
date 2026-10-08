"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadMyActiveRandomSession, loadMyProfile, loadMyRandomQueue, supabase, type RandomQueueRow } from "../../../lib/supabase";
import { isAiHelperTester } from "../../../lib/ai-helper";

type HelperMessage = { role: "user" | "assistant"; content: string };

const GREETING = "嗨，我是 HerLink 小幫手。真人還在路上，我先陪你一下。你不用退出這裡，我會繼續幫你等人；有人出現時，我會馬上告訴你。";

export default function AiHelperPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelperMessage[]>([{ role: "assistant", content: GREETING }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace("/");
      const [profileResult, queueResult, humanResult] = await Promise.all([
        loadMyProfile(data.session.user.id),
        loadMyRandomQueue(data.session.user.id),
        loadMyActiveRandomSession(),
      ]);
      if (!mounted) return;
      const name = profileResult.data?.anonymous_display_name ?? null;
      if (!isAiHelperTester(name)) return router.replace("/waiting");
      if (humanResult.data) return router.replace(`/session/${humanResult.data.id}`);
      if (!queueResult.data || queueResult.data.status !== "waiting") return router.replace("/waiting");
      setUserId(data.session.user.id);
      setDisplayName(name);
    })();
    return () => { mounted = false; };
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`ai-helper-human-match-${userId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "random_match_queue",
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const next = payload.new as RandomQueueRow;
        if (next.status === "matched" && next.matched_session_id) {
          // Temporary first integration: the authoritative human match wins immediately.
          // The next task replaces this with the approved 10-second accept/reject handoff.
          setMessages([]);
          router.replace(`/session/${next.matched_session_id}`);
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [router, userId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || unavailable || !userId || !displayName) return;
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setDraft("");
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/ai-helper/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: nextMessages.slice(-20) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.reply !== "string") throw new Error("helper_unavailable");
      setMessages((current) => [...current, { role: "assistant", content: body.reply }]);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };

  const leaveHelper = () => {
    setMessages([]);
    router.replace("/waiting");
  };

  return (
    <main className="stack">
      <section className="hero">
        <div>
          <h1 className="hero-title">HerLink 小幫手 ✦ 官方</h1>
          <p className="hero-copy">官方 AI 小幫手・不是匿名真人</p>
          <div className="muted small">正在幫你找真人…</div>
        </div>

        <div className="stack" aria-live="polite">
          {messages.map((message, index) => (
            <div className="row" key={`${message.role}-${index}`}>
              <div>
                <div className="muted small">{message.role === "assistant" ? "HerLink 小幫手" : displayName ?? "你"}</div>
                <div>{message.content}</div>
              </div>
            </div>
          ))}
          {busy ? <div className="muted small">小幫手正在回覆…</div> : null}
          {unavailable ? (
            <div className="stack">
              <div className="title">小幫手暫時去休息了</div>
              <div className="muted">別擔心，我們還在幫你找聊天對象。</div>
              <div className="row">
                <button className="button secondary" onClick={leaveHelper}>繼續等人</button>
                <button className="ghost" onClick={() => { setMessages([]); router.replace("/"); }}>回首頁</button>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {!unavailable ? (
          <form className="row" onSubmit={send}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="跟小幫手說點什麼…"
              maxLength={2000}
              disabled={busy}
              aria-label="傳訊息給 HerLink 小幫手"
            />
            <button className="button" type="submit" disabled={busy || !draft.trim()}>送出</button>
          </form>
        ) : null}

        <button className="ghost" onClick={leaveHelper}>離開小幫手，繼續等真人</button>
      </section>
    </main>
  );
}
