"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../lib/auth-ui";
import {
  getShortId,
  isNavigationDebugEnabled,
  readLastNavigationDiagnostic,
  recordNavigationDiagnostic,
  withNavigationDebugParam,
  type NavigationDiagnosticEvent,
} from "../lib/navigation-diagnostics";
import { useOnlinePresence } from "../lib/realtime-presence";
import { MAINTENANCE_MESSAGE, MAINTENANCE_MODE, MAINTENANCE_TITLE } from "../lib/site-config";
import {
  findOrJoinRandomMatch,
  getCurrentSession,
  ensureAnonymousBootstrapProfile,
  isAnonymousProfileReady,
  isSupabaseConfigured,
  leaveRandomQueue,
  leaveRandomSession,
  loadMyActiveRandomSession,
  loadMyLatestRandomSessionDiagnostic,
  loadMyProfile,
  loadMyRandomQueue,
  registerAnonymousAbuseIdentity,
  signInAnonymously,
  signOut,
  type RandomQueueRow,
  type RandomSessionRow,
  type LatestRandomSessionDiagnosticRow,
  type Session,
  type WebProfile,
} from "../lib/supabase";
import { Badge, Button, Notice, PageHero, Surface } from "../components/ui";

type BootstrapState = {
  session: Session | null;
  profile: WebProfile | null;
  queue: RandomQueueRow | null;
  activeSession: RandomSessionRow | null;
};

type ActiveSessionLookup = {
  result: "loading" | "RPC SUCCESS" | "NOT FOUND" | "RPC ERROR";
  error: string | null;
};

const emptyBootstrapState: BootstrapState = {
  session: null,
  profile: null,
  queue: null,
  activeSession: null,
};

const initialActiveSessionLookup: ActiveSessionLookup = {
  result: "loading",
  error: null,
};

function summarizeActiveSessionRpcError(error: { code?: unknown; message?: unknown } | null) {
  const code = typeof error?.code === "string" && error.code ? error.code.slice(0, 40) : "RPC_ERROR";
  const message = typeof error?.message === "string" && error.message
    ? error.message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
      .replace(/[^\s@]+@[^\s@]+/g, "[email]")
      .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[token]")
      .replace(/(token|apikey|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
      .replace(/\s+/g, " ")
      .slice(0, 160)
    : "Active session RPC failed.";
  return `${code}: ${message}`;
}

export default function HomePage() {
  const router = useRouter();
  const pathname = usePathname();
  const navigatingToSessionRef = useRef(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [state, setState] = useState<BootstrapState>(emptyBootstrapState);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [lastDiagnostic, setLastDiagnostic] = useState<NavigationDiagnosticEvent | null>(null);
  const [activeSessionLookup, setActiveSessionLookup] = useState<ActiveSessionLookup>(initialActiveSessionLookup);
  const [latestSessionDiagnostic, setLatestSessionDiagnostic] = useState<LatestRandomSessionDiagnosticRow | null>(null);
  const [latestSessionDiagnosticLoaded, setLatestSessionDiagnosticLoaded] = useState(false);
  const [latestSessionDiagnosticError, setLatestSessionDiagnosticError] = useState(false);
  const [showTestUid, setShowTestUid] = useState(false);
  const [testUidCopied, setTestUidCopied] = useState(false);
  const { onlineCount, onlineCountConnected } = useOnlinePresence(state.session?.user.id ?? null);

  const recordHomeRouteDiagnostic = (eventType: "continue_clicked" | "continue_routed", metadata: Record<string, unknown> = {}) => {
    const targetSessionId =
      typeof metadata.target === "string" ? metadata.target.split("/session/")[1]?.split("?")[0] ?? null : null;
    const nextEvent: NavigationDiagnosticEvent = {
      timestamp: new Date().toISOString(),
      pathname,
      event: eventType === "continue_clicked" ? "HOME_CONTINUE_CLICK" : "HOME_CONTINUE_ROUTE",
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
      redirectReason: typeof metadata.reason === "string" ? metadata.reason : null,
      authState: state.session ? "ready" : bootstrapping ? "loading" : "missing",
      sessionState: state.activeSession?.status === "active" ? "active" : "missing",
      routeSessionIdShort: getShortId(targetSessionId),
      serverSessionIdShort: getShortId(state.activeSession?.id ?? null),
      bootstrapRunId: null,
    };

    recordNavigationDiagnostic(nextEvent);
    setLastDiagnostic(nextEvent);
  };

  const continueActiveSession = (event?: MouseEvent<HTMLButtonElement>) => {
    if (!state.activeSession?.id) {
      return;
    }

    recordHomeRouteDiagnostic(event ? "continue_clicked" : "continue_routed", {
      target: `/session/${state.activeSession.id}`,
      buttonType: event?.currentTarget.type ?? null,
      inForm: Boolean(event?.currentTarget.form),
    });
    navigatingToSessionRef.current = true;
    router.push(withNavigationDebugParam(`/session/${state.activeSession.id}`));
  };

  const leaveActiveSession = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!event.nativeEvent.isTrusted || !state.activeSession?.id) {
      return;
    }

    if (!window.confirm("確定要離開這個聊天室嗎？")) {
      return;
    }

    setActionBusy(true);
    try {
      await leaveRandomSession(state.activeSession.id);
      setState((prev) => ({ ...prev, activeSession: null }));
      setMessage("已離開聊天室。");
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    let authUserId: string | null = null;

    async function bootstrap() {
      setBootstrapping(true);
      try {
        const { data } = await getCurrentSession();
        const session = data.session ?? null;
        authUserId = session?.user.id ?? null;

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

        const rpcError = sessionResult.error as { code?: unknown; message?: unknown } | null;
        const lookup = rpcError
          ? { result: "RPC ERROR" as const, error: summarizeActiveSessionRpcError(rpcError) }
          : sessionResult.data
            ? { result: "RPC SUCCESS" as const, error: null }
            : { result: "NOT FOUND" as const, error: null };
        const diagnostic: NavigationDiagnosticEvent = {
          timestamp: new Date().toISOString(),
          pathname,
          event: lookup.result === "RPC SUCCESS"
            ? "RPC_SUCCESS_ACTIVE_SESSION"
            : lookup.result === "NOT FOUND"
              ? "ACTIVE_SESSION_NOT_FOUND"
              : "ACTIVE_SESSION_RPC_ERROR",
          reason: null,
          redirectReason: null,
          authState: "ready",
          sessionState: lookup.result === "RPC ERROR" ? "error" : sessionResult.data?.status === "active" ? "active" : "missing",
          routeSessionIdShort: null,
          serverSessionIdShort: getShortId(sessionResult.data?.id ?? null),
          bootstrapRunId: null,
          activeSessionResult: lookup.result,
          authUserIdShort: getShortId(session.user.id),
          activeSessionError: lookup.error,
        };

        setActiveSessionLookup(lookup);
        recordNavigationDiagnostic(diagnostic);
        setLastDiagnostic(diagnostic);

        setState({
          session,
          profile: profileResult.data ?? null,
          queue: queueResult.data ?? null,
          activeSession: rpcError ? null : sessionResult.data ?? null,
        });

        if (isNavigationDebugEnabled()) {
          const latestResult = await loadMyLatestRandomSessionDiagnostic();
          if (mounted) {
            setLatestSessionDiagnostic(latestResult.error ? null : latestResult.data);
            setLatestSessionDiagnosticError(Boolean(latestResult.error));
            setLatestSessionDiagnosticLoaded(true);
          }
        }
      } catch {
        if (mounted) {
          setState(emptyBootstrapState);
          const error = "BOOTSTRAP_ERROR: Active session lookup did not complete.";
          const diagnostic: NavigationDiagnosticEvent = {
            timestamp: new Date().toISOString(),
            pathname,
            event: "ACTIVE_SESSION_RPC_ERROR",
            reason: null,
            redirectReason: null,
            authState: authUserId ? "ready" : "missing",
            sessionState: "error",
            routeSessionIdShort: null,
            serverSessionIdShort: null,
            bootstrapRunId: null,
            activeSessionResult: "RPC ERROR",
            authUserIdShort: getShortId(authUserId),
            activeSessionError: error,
          };
          setActiveSessionLookup({ result: "RPC ERROR", error });
          recordNavigationDiagnostic(diagnostic);
          setLastDiagnostic(diagnostic);
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
    if (navigatingToSessionRef.current || pathname !== "/") return;

    if (!state.profile || !isAnonymousProfileReady(state.profile)) {
      router.replace("/onboarding");
      return;
    }

    if (state.queue?.status === "waiting" && !state.queue.matched_session_id) {
      router.replace("/waiting");
    }
  }, [bootstrapping, pathname, router, state.profile, state.queue, state.session]);

  useEffect(() => {
    setDebugEnabled(isNavigationDebugEnabled());
    setLastDiagnostic(readLastNavigationDiagnostic());
  }, [pathname]);

  const anonymousSummary = useMemo(() => {
    if (!state.profile) return null;
    return {
      name: state.profile.anonymous_display_name ?? "匿名使用者",
    };
  }, [state.profile]);

  const copyTestUid = async () => {
    const userId = state.session?.user.id;
    if (!userId || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(userId);
      setTestUidCopied(true);
    } catch {
      setTestUidCopied(false);
    }
  };

  const debugPanel = debugEnabled ? (
    <div className="debug-panel">
      <div>path: {pathname}</div>
      <div>auth: {state.session ? "ready" : bootstrapping ? "loading" : "missing"}</div>
      <div>session: {activeSessionLookup.result === "RPC ERROR" ? "error" : state.activeSession?.status ?? "missing"}</div>
      <div>ACTIVE SESSION RESULT: {activeSessionLookup.result}</div>
      <div>CURRENT AUTH UID: {getShortId(state.session?.user.id ?? null) ?? "none"}</div>
      <div>ACTIVE SESSION ID: {getShortId(state.activeSession?.id ?? null) ?? "none"}</div>
      {activeSessionLookup.error ? <div>RPC ERROR: {activeSessionLookup.error}</div> : null}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="ghost" onClick={() => setShowTestUid(true)} disabled={!state.session?.user.id}>
          顯示本機測試 UID
        </button>
        {showTestUid && state.session?.user.id ? (
          <button type="button" className="ghost" onClick={() => void copyTestUid()}>
            {testUidCopied ? "UID 已複製" : "複製 UID"}
          </button>
        ) : null}
      </div>
      {showTestUid && state.session?.user.id ? <div>TEST UID: {state.session.user.id}</div> : null}
      <div>LATEST RANDOM SESSION: {latestSessionDiagnosticError ? "unavailable" : latestSessionDiagnosticLoaded ? getShortId(latestSessionDiagnostic?.session_id ?? null) ?? "none" : "loading"}</div>
      <div>STATUS: {latestSessionDiagnostic?.status ?? "none"}</div>
      <div>ENDED REASON: {latestSessionDiagnostic?.ended_reason ?? "none"}</div>
      <div>ENDED BY: {latestSessionDiagnostic?.ended_by_me ? "me" : latestSessionDiagnostic?.ended_by_partner ? "partner" : "unknown"}</div>
      <div>ENDED AT: {latestSessionDiagnostic?.ended_at ?? "none"}</div>
      <div>LAST SESSION EVENT: {lastDiagnostic?.event ?? "none"}</div>
      <div>LAST REDIRECT REASON: {lastDiagnostic?.redirectReason ?? lastDiagnostic?.reason ?? "none"}</div>
      <div>AUTH STATE: {lastDiagnostic?.authState ?? (state.session ? "ready" : bootstrapping ? "loading" : "missing")}</div>
      <div>SESSION STATE: {lastDiagnostic?.sessionState ?? state.activeSession?.status ?? "missing"}</div>
      <div>ROUTE SESSION ID: {lastDiagnostic?.routeSessionIdShort ?? "none"}</div>
      <div>SERVER SESSION ID: {getShortId(state.activeSession?.id ?? null) ?? lastDiagnostic?.serverSessionIdShort ?? "none"}</div>
    </div>
  ) : null;

  if (MAINTENANCE_MODE) {
    return (
      <main className="stack">
        <PageHero
          kicker={<Badge variant="accent">維護中</Badge>}
          title={MAINTENANCE_TITLE}
          description={MAINTENANCE_MESSAGE}
        >
          <Notice>目前先暫停新的隨機配對。已經在聊天中的匿名對話不會被強制中斷。</Notice>
          {state.activeSession ? (
            <Notice variant="info" title="你有一個尚未結束的聊天室。">
              <div className="row">
                <Button size="md" onClick={continueActiveSession} disabled={actionBusy}>繼續聊天</Button>
                <Button variant="danger" size="md" onClick={(event) => void leaveActiveSession(event)} disabled={actionBusy}>離開聊天室</Button>
              </div>
            </Notice>
          ) : null}
        </PageHero>
        {debugPanel}
      </main>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <main className="stack">
        <PageHero
          title="HerLink Web V0.1"
          description="缺少 Supabase 設定，請先補上 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。"
        />
        {debugPanel}
      </main>
    );
  }

  if (bootstrapping) {
    return (
      <main className="stack">
        <PageHero title="HerLink" description="正在檢查登入狀態…" />
        {debugPanel}
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
        setState({
          session: data.session,
          profile: profileResult.data ?? null,
          queue: null,
          activeSession: null,
        });
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
        <PageHero
          title="HerLink"
          description="不用註冊、不用公開真實資料，直接建立匿名身份開始聊天。"
          actions={
            <>
              <Button size="lg" onClick={startAnonymous} disabled={actionBusy}>
                {actionBusy ? "建立匿名身份中…" : "開始匿名聊天"}
              </Button>
              {onlineCountConnected ? <Badge variant="success">目前在線 {onlineCount} 人</Badge> : null}
            </>
          }
        >
          {message ? <Notice variant="warning">{message}</Notice> : null}
        </PageHero>
        <Surface elevation={1}>
          <Notice variant="danger" title="安全提醒">
            請勿向陌生人匯款、投資或提供銀行資料、信用卡資訊與驗證碼。
          </Notice>
          <p className="muted small">使用 HerLink 即表示你已年滿 18 歲，並同意服務條款與隱私權政策。</p>
          <div className="link-row">
            <Button variant="link" href="/terms">服務條款</Button>
            <Button variant="link" href="/privacy">隱私權政策</Button>
            <Button variant="link" href="/safety">安全說明</Button>
          </div>
        </Surface>
        {debugPanel}
      </main>
    );
  }

  const startMatching = async () => {
    if (MAINTENANCE_MODE) {
      setMessage("HerLink 維護中，聊天功能目前暫時停止。");
      return;
    }

    if (state.activeSession?.id) {
      continueActiveSession();
      return;
    }

    setActionBusy(true);
    setMessage(null);
    try {
      const runAbuseCheck = async () => {
        const abuseCheck = await registerAnonymousAbuseIdentity();
        if (abuseCheck.error) {
          throw abuseCheck.error;
        }

        if (abuseCheck.data && abuseCheck.data.decision !== "allow") {
          return false;
        }

        return true;
      };

      if (!(await runAbuseCheck())) {
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
      <PageHero title="HerLink" description="匿名聊天，不需要公開自己。">
        {MAINTENANCE_MODE ? (
          <Notice variant="warning" title="HerLink 維護中。">{MAINTENANCE_MESSAGE}</Notice>
        ) : null}
        <Surface elevation="inset">
          <div className="row">
            <Badge variant="accent">匿名身份</Badge>
            <strong>{anonymousSummary?.name ?? "匿名使用者"}</strong>
          </div>
        </Surface>
      </PageHero>

      <Surface elevation={1}>
        <div className="row">
          <Button size="lg" onClick={startMatching} disabled={actionBusy || MAINTENANCE_MODE}>
            {actionBusy ? "處理中…" : MAINTENANCE_MODE ? "維護中" : state.activeSession ? "繼續聊天" : "開始隨機配對"}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => router.push("/onboarding")} disabled={actionBusy || MAINTENANCE_MODE}>
            重新設定匿名身份
          </Button>
        </div>
        {state.activeSession ? (
          <Notice variant="info" title="你有一個尚未結束的聊天室。">
            <div className="row">
              <Button size="md" onClick={continueActiveSession} disabled={actionBusy}>繼續聊天</Button>
              <Button variant="danger" size="md" onClick={(event) => void leaveActiveSession(event)} disabled={actionBusy}>離開聊天室</Button>
            </div>
          </Notice>
        ) : null}
        {state.queue?.status === "waiting" ? (
          <Notice variant="info" title="你正在等待配對中。">
            <div className="row">
              <Button variant="secondary" size="md" onClick={leaveQueue} disabled={actionBusy}>取消等待</Button>
            </div>
          </Notice>
        ) : null}
        {message ? <Notice variant="warning">{message}</Notice> : null}
      </Surface>

      <Surface elevation={1}>
        <div className="title">安全提醒</div>
        <p className="hero-copy">請勿匯款、投資或提供驗證碼。若遇到可疑內容，請直接封鎖、檢舉並離開。</p>
        <div className="row">
          <Button variant="secondary" onClick={logout} disabled={actionBusy}>登出</Button>
          <div className="muted small">
            目前會話：{state.activeSession ? "已配對" : "未配對"}
          </div>
        </div>
        {onlineCountConnected ? <div className="muted small">目前在線 {onlineCount} 人</div> : null}
      </Surface>

      {debugPanel}
    </main>
  );
}
