"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../lib/auth-ui";
import { useOnlinePresence } from "../lib/realtime-presence";
import { MAINTENANCE_MESSAGE, MAINTENANCE_MODE, MAINTENANCE_TITLE } from "../lib/site-config";
import {
  findOrJoinRandomMatch,
  getCurrentSession,
  getSupabaseDiagnostics,
  ensureAnonymousBootstrapProfile,
  isAnonymousProfileReady,
  isSupabaseConfigured,
  leaveRandomQueue,
  loadMyActiveRandomSession,
  loadMyProfile,
  loadMyRandomQueue,
  registerAnonymousAbuseIdentity,
  signInAnonymously,
  signOut,
  type RandomQueueRow,
  type RandomSessionRow,
  type Session,
  type WebProfile,
} from "../lib/supabase";

type BootstrapState = {
  session: Session | null;
  profile: WebProfile | null;
  queue: RandomQueueRow | null;
  activeSession: RandomSessionRow | null;
};

const emptyBootstrapState: BootstrapState = {
  session: null,
  profile: null,
  queue: null,
  activeSession: null,
};

export default function HomePage() {
  const router = useRouter();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [state, setState] = useState<BootstrapState>(emptyBootstrapState);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { onlineCount, onlineCountConnected } = useOnlinePresence(state.session?.user.id ?? null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      setBootstrapping(true);
      try {
        const { data } = await getCurrentSession();
        const session = data.session ?? null;

        if (!session) {
          if (mounted) {
            setState(emptyBootstrapState);
          }
          return;
        }

        const [profileResult, queueResult, sessionResult] = await Promise.all([
          loadMyProfile(session.user.id),
          loadMyRandomQueue(session.user.id),
          loadMyActiveRandomSession(),
        ]);

        if (!mounted) {
          return;
        }

        setState({
          session,
          profile: profileResult.data ?? null,
          queue: queueResult.data ?? null,
          activeSession: sessionResult.data ?? null,
        });
      } catch {
        if (mounted) {
          setState(emptyBootstrapState);
          setMessage("目前無法載入狀態，請重新整理後再試。");
        }
      } finally {
        if (mounted) {
          setBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (bootstrapping) return;
    if (!state.session) return;

    if (!state.profile || !isAnonymousProfileReady(state.profile)) {
      router.replace("/onboarding");
      return;
    }

    if (state.activeSession) {
      router.replace(`/session/${state.activeSession.id}`);
      return;
    }

    if (state.queue?.status === "waiting" && !state.queue.matched_session_id) {
      router.replace("/waiting");
    }
  }, [bootstrapping, router, state.activeSession, state.profile, state.queue, state.session]);

  const anonymousSummary = useMemo(() => {
    if (!state.profile) return null;
    return {
      name: state.profile.anonymous_display_name ?? "匿名使用者",
    };
  }, [state.profile]);

  if (MAINTENANCE_MODE && !state.activeSession) {
    return (
      <main className="stack">
        <section className="hero">
          <div className="status-badge" style={{ color: "var(--accent-strong)", borderColor: "rgba(255, 111, 97, 0.24)" }}>
            維護中
          </div>
          <h1 className="hero-title">{MAINTENANCE_TITLE}</h1>
          <p className="hero-copy">{MAINTENANCE_MESSAGE}</p>
          <div className="notice">
            目前先暫停新的隨機配對。已經在聊天中的匿名對話不會被強制中斷。
          </div>
        </section>
      </main>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <main className="panel">
        <h1 className="hero-title">HerLink Web V0.1</h1>
        <p className="hero-copy">缺少 Supabase 設定，請先補上 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。</p>
      </main>
    );
  }

  if (bootstrapping) {
    return (
      <main className="hero">
        <h1 className="hero-title">HerLink</h1>
        <p className="hero-copy">正在檢查登入狀態…</p>
      </main>
    );
  }

  const startAnonymous = async () => {
    if (MAINTENANCE_MODE) {
      setMessage("HerLink 維護中，聊天功能目前暫時停止。");
      return;
    }

    setActionBusy(true);
    setMessage(null);
    try {
      const { data, error } = await signInAnonymously();
      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("匿名登入未建立工作階段");
      }

      const profileResult = await ensureAnonymousBootstrapProfile(data.session.user.id);
      if (profileResult.error) {
        throw profileResult.error;
      }

      const abuseCheck = await registerAnonymousAbuseIdentity();
      if (abuseCheck.error) {
        throw abuseCheck.error;
      }

      if (abuseCheck.data && abuseCheck.data.decision !== "allow") {
        await signOut();
        setState(emptyBootstrapState);
        setMessage("此帳號目前無法使用配對功能，請稍後再試。");
        return;
      }

      router.replace("/onboarding");
    } catch (error) {
      setMessage(getFriendlyAuthErrorMessage(error, "目前無法建立匿名身份，請稍後再試。"));
    } finally {
      setActionBusy(false);
    }
  };

  if (!state.session) {
    return (
      <main className="stack">
        <section className="hero">
          <h1 className="hero-title">HerLink</h1>
          <p className="hero-copy">不用註冊、不用公開真實資料，直接建立匿名身份開始聊天。</p>
        <div className="row">
          <button className="button" onClick={startAnonymous} disabled={actionBusy}>
            {actionBusy ? "建立匿名身份中…" : "開始匿名聊天"}
          </button>
        </div>
        {onlineCountConnected ? <div className="muted small">目前在線 {onlineCount} 人</div> : null}
        {message ? <div className="notice">{message}</div> : null}
      </section>
        <section className="panel">
          <p className="notice">請勿向陌生人匯款、投資或提供銀行資料、信用卡資訊與驗證碼。</p>
          <p className="muted small" style={{ marginTop: 12 }}>
            使用 HerLink 即表示你已年滿 18 歲，並同意服務條款與隱私權政策。
          </p>
          <div className="link-row">
            <a className="link" href="/terms">服務條款</a>
            <a className="link" href="/privacy">隱私權政策</a>
            <a className="link" href="/safety">安全說明</a>
          </div>
        </section>
      </main>
    );
  }

  const startMatching = async () => {
    if (MAINTENANCE_MODE) {
      setMessage("HerLink 維護中，聊天功能目前暫時停止。");
      return;
    }

    setActionBusy(true);
    setMessage(null);
    try {
      const abuseCheck = await registerAnonymousAbuseIdentity();
      if (abuseCheck.error) {
        throw abuseCheck.error;
      }

      if (abuseCheck.data && abuseCheck.data.decision !== "allow") {
        setMessage("此帳號目前無法使用配對功能，請稍後再試。");
        return;
      }

      const { data, error } = await findOrJoinRandomMatch();
      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (result?.status === "matched" && result.session_id) {
        router.replace(`/session/${result.session_id}`);
        return;
      }

      router.replace("/waiting");
    } catch (error) {
      setMessage(getFriendlyAuthErrorMessage(error, "目前無法開始配對，請稍後再試。"));
    } finally {
      setActionBusy(false);
    }
  };

  const leaveQueue = async () => {
    setActionBusy(true);
    try {
      await leaveRandomQueue();
      setState((prev) => ({ ...prev, queue: null }));
      setMessage("已離開等待池。");
    } finally {
      setActionBusy(false);
    }
  };

  const logout = async () => {
    setActionBusy(true);
    try {
      await signOut();
      setState(emptyBootstrapState);
      router.replace("/");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <main className="stack">
      <section className="hero">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 className="hero-title" style={{ marginBottom: 8 }}>HerLink</h1>
            <p className="hero-copy">匿名聊天，不需要公開自己。</p>
          </div>
        </div>
        {MAINTENANCE_MODE ? (
          <div className="notice">
            <strong>HerLink 維護中。</strong>
            <div style={{ marginTop: 8 }}>{MAINTENANCE_MESSAGE}</div>
          </div>
        ) : null}
        <div className="notice">
          你目前的匿名身份是 <strong>{anonymousSummary?.name ?? "匿名使用者"}</strong>。
        </div>
        <div className="row">
          <button className="button" onClick={startMatching} disabled={actionBusy || MAINTENANCE_MODE}>
            {actionBusy ? "處理中…" : MAINTENANCE_MODE ? "維護中" : "開始隨機配對"}
          </button>
          <button className="ghost" onClick={() => router.push("/onboarding")} disabled={actionBusy || MAINTENANCE_MODE}>
            重新設定匿名身份
          </button>
        </div>
        {state.queue?.status === "waiting" ? (
          <div className="banner">
            你正在等待配對中。
            <div style={{ marginTop: 12 }}>
              <button className="button secondary" onClick={leaveQueue} disabled={actionBusy}>
                取消等待
              </button>
            </div>
          </div>
        ) : null}
        {message ? <div className="notice">{message}</div> : null}
      </section>

      <section className="panel">
        <p className="title">安全提醒</p>
        <p className="hero-copy">請勿匯款、投資或提供驗證碼。若遇到可疑內容，請直接封鎖、檢舉並離開。</p>
        <div className="row">
          <button className="ghost" onClick={logout} disabled={actionBusy}>
            登出
          </button>
          <div className="muted small">
            目前會話：{state.activeSession ? "已配對" : "未配對"}
          </div>
        </div>
        {onlineCountConnected ? <div className="muted small">目前在線 {onlineCount} 人</div> : null}
      </section>

      <section className="footer">
        <div>Supabase 連線：{getSupabaseDiagnostics().hasUrl ? "URL 已設定" : "URL 未設定"}</div>
        <div>匿名金鑰：{getSupabaseDiagnostics().hasAnonKey ? "已設定" : "未設定"}</div>
      </section>
    </main>
  );
}
