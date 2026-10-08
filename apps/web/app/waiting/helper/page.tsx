"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { declineAiHelperHandoff, findOrJoinRandomMatch, leaveRandomQueue, loadMyActiveRandomSession, loadMyProfile, loadMyRandomQueue, supabase, type RandomQueueRow } from "../../../lib/supabase";
import { AI_HANDOFF_TIMEOUT_MS, isAiHelperTester, nextHandoffState } from "../../../lib/ai-helper";

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
  const [handoffSessionId, setHandoffSessionId] = useState<string | null>(null);
  const [handoffSeconds, setHandoffSeconds] = useState(10);
  const [rejectionCount, setRejectionCount] = useState(0);
  const [matchingPaused, setMatchingPaused] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const resolvingHandoffRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace("/");
      const [profileResult, queueResult, humanResult] = await Promise.all([
        loadMyProfile(data.session.user.id), loadMyRandomQueue(data.session.user.id), loadMyActiveRandomSession(),
      ]);
      if (!mounted) return;
      const name = profileResult.data?.anonymous_display_name ?? null;
      if (!isAiHelperTester(name)) return router.replace("/waiting");

      setUserId(data.session.user.id);
      setDisplayName(name);

      // A human can match in the short race between tapping the helper offer and
      // this page bootstrapping. Keep the helper handoff contract: prompt first,
      // never silently redirect into the human room.
      if (humanResult.data) {
        setHandoffSeconds(Math.ceil(AI_HANDOFF_TIMEOUT_MS / 1000));
        setHandoffSessionId(humanResult.data.id);
        return;
      }

      if (!queueResult.data || queueResult.data.status !== "waiting") return router.replace("/waiting");
    })();
    return () => { mounted = false; requestRef.current?.abort(); setMessages([]); };
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`ai-helper-human-match-${userId}`).on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "random_match_queue", filter: `user_id=eq.${userId}`,
    }, (payload) => {
      const next = payload.new as RandomQueueRow;
      if (next.status === "matched" && next.matched_session_id && !resolvingHandoffRef.current) {
        requestRef.current?.abort();
        setBusy(false);
        setHandoffSeconds(Math.ceil(AI_HANDOFF_TIMEOUT_MS / 1000));
        setHandoffSessionId(next.matched_session_id);
      }
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId]);

  const rejectHandoff = useCallback(async (reason: "reject" | "timeout") => {
    if (!handoffSessionId || resolvingHandoffRef.current) return;
    resolvingHandoffRef.current = true;
    const sessionId = handoffSessionId;
    setHandoffSessionId(null);
    const next = nextHandoffState({ rejectionCount, action: reason });
    try {
      const result = await declineAiHelperHandoff(sessionId);
      if (result.error) throw new Error(result.error.message ?? "handoff_release_failed");
      setRejectionCount(next.rejectionCount);
      if (next.pauseMatching) {
        await leaveRandomQueue();
        setMatchingPaused(true);
      }
    } catch {
      setUnavailable(true);
    } finally {
      resolvingHandoffRef.current = false;
    }
  }, [handoffSessionId, rejectionCount]);

  useEffect(() => {
    if (!handoffSessionId) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, AI_HANDOFF_TIMEOUT_MS - (Date.now() - startedAt));
      setHandoffSeconds(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        window.clearInterval(timer);
        void rejectHandoff("timeout");
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [handoffSessionId, rejectHandoff]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy, handoffSessionId]);

  const acceptHandoff = () => {
    if (!handoffSessionId || resolvingHandoffRef.current) return;
    resolvingHandoffRef.current = true;
    requestRef.current?.abort();
    const target = handoffSessionId;
    setMessages([]);
    setHandoffSessionId(null);
    router.replace(`/session/${target}`);
  };

  const restartMatching = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await findOrJoinRandomMatch();
      if (result.error) throw new Error(result.error.message ?? "restart_failed");
      setRejectionCount(0);
      setMatchingPaused(false);
      const row = Array.isArray(result.data) ? result.data[0] : null;
      if (row?.status === "matched" && row.session_id) setHandoffSessionId(row.session_id);
    } catch {
      setUnavailable(true);
    } finally { setBusy(false); }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || unavailable || handoffSessionId || !userId || !displayName) return;
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages); setDraft(""); setBusy(true);
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/ai-helper/chat", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: nextMessages.slice(-20) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.reply !== "string") throw new Error("helper_unavailable");
      if (!controller.signal.aborted) setMessages((current) => [...current, { role: "assistant", content: body.reply }]);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setUnavailable(true);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      setBusy(false);
    }
  };

  const leaveHelper = () => { requestRef.current?.abort(); setMessages([]); router.replace("/waiting"); };

  return (
    <main className="stack"><section className="hero">
      <div><h1 className="hero-title">HerLink 小幫手 ✦ 官方</h1><p className="hero-copy">官方 AI 小幫手・不是匿名真人</p><div className="muted small">{matchingPaused ? "真人搜尋已暫停" : "正在幫你找真人…"}</div></div>

      {handoffSessionId ? <div className="stack" role="dialog" aria-live="assertive">
        <div className="title">有人來了！有人也正在等聊天，要去認識她嗎？</div>
        <div className="muted small">{handoffSeconds} 秒後會自動略過，讓對方回到等待中。</div>
        <div className="row"><button className="button" onClick={acceptHandoff}>去認識她</button><button className="button secondary" onClick={() => void rejectHandoff("reject")}>這次先不要</button></div>
      </div> : null}

      {matchingPaused ? <div className="stack"><div className="title">已先暫停幫你找真人</div><div className="muted">你連續略過了 3 次真人，可以繼續跟小幫手聊；想找人時再重新開始。</div><button className="button secondary" onClick={() => void restartMatching()}>重新開始找人</button></div> : null}

      <div className="stack" aria-live="polite">
        {messages.map((message,index)=><div className="row" key={`${message.role}-${index}`}><div><div className="muted small">{message.role === "assistant" ? "HerLink 小幫手" : displayName ?? "你"}</div><div>{message.content}</div></div></div>)}
        {busy ? <div className="muted small">小幫手正在回覆…</div> : null}
        {unavailable ? <div className="stack"><div className="title">小幫手暫時去休息了</div><div className="muted">別擔心，真人配對不會因為小幫手故障而中斷。</div><div className="row"><button className="button secondary" onClick={leaveHelper}>繼續等人</button><button className="ghost" onClick={()=>{setMessages([]);router.replace("/");}}>回首頁</button></div></div> : null}
        <div ref={endRef}/>
      </div>

      {!unavailable ? <form className="row" onSubmit={send}><input value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder="跟小幫手說點什麼…" maxLength={2000} disabled={busy || Boolean(handoffSessionId)} aria-label="傳訊息給 HerLink 小幫手"/><button className="button" type="submit" disabled={busy || Boolean(handoffSessionId) || !draft.trim()}>送出</button></form> : null}
      <button className="ghost" onClick={leaveHelper}>離開小幫手，繼續等真人</button>
    </section></main>
  );
}
