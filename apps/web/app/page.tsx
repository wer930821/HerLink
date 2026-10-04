"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ANONYMOUS_DISPLAY_NAME_MAX_LENGTH,
  randomizeAnonymousDisplayName,
  renameAnonymousDisplayName,
  validateAnonymousDisplayNameDraft,
  anonymousRenameErrorMessage,
} from "../lib/anonymous-rename";
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
  buildBrowserHandoffUrl,
  findOrJoinRandomMatch,
  getCurrentSession,
  ensureAnonymousBootstrapProfile,
  isSupabaseConfigured,
  leaveRandomQueue,
  leaveRandomSession,
  loadMyActiveRandomSession,
  loadMyLatestRandomSessionDiagnostic,
  loadMyProfile,
  loadMyRandomQueue,
  registerAnonymousAbuseIdentity,
  signInAnonymously,
  requestRandomIdentityRecovery,
  signOut,
  type RandomQueueRow,
  type RandomSessionRow,
  type LatestRandomSessionDiagnosticRow,
  type Session,
  type AnonymousAbusePrecheckRow,
  type WebProfile,
  supabase,
} from "../lib/supabase";
import { Badge, Button, Field, Modal, Notice, PageHero, Surface } from "../components/ui";

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
  const anonymousStartInFlightRef = useRef(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [state, setState] = useState<BootstrapState>(emptyBootstrapState);
  const [actionBusy, setActionBusy] = useState(false);
  const [femaleOnlyOpen, setFemaleOnlyOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryName, setRecoveryName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [lastDiagnostic, setLastDiagnostic] = useState<NavigationDiagnosticEvent | null>(null);
  const [activeSessionLookup, setActiveSessionLookup] = useState<ActiveSessionLookup>(initialActiveSessionLookup);
  const [latestSessionDiagnostic, setLatestSessionDiagnostic] = useState<LatestRandomSessionDiagnosticRow | null>(null);
  const [latestSessionDiagnosticLoaded, setLatestSessionDiagnosticLoaded] = useState(false);
  const [latestSessionDiagnosticError, setLatestSessionDiagnosticError] = useState(false);
  const [showTestUid, setShowTestUid] = useState(false);
  const [testUidCopied, setTestUidCopied] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [randomBusy, setRandomBusy] = useState(false);
  const [renameNotice, setRenameNotice] = useState<string | null>(null);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const [mailUnreadCount, setMailUnreadCount] = useState(0);
  const waitingCountRequestRef = useRef(0);
  const { onlineCount, onlineCountConnected } = useOnlinePresence(state.session?.user.id ?? null);

  const refreshMailUnread = useCallback(async () => {
    if (!state.session?.user.id) { setMailUnreadCount(0); return; }
    const { data } = await (supabase as any).rpc("station_mail_user_unread_count");
    setMailUnreadCount(Number(data ?? 0));
  }, [state.session?.user.id]);

  useEffect(() => {
    if (!state.session?.user.id) return;
    void refreshMailUnread();
    const channel = supabase.channel(`home-mailbox-${state.session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_mail_threads", filter: `user_id=eq.${state.session.user.id}` }, () => void refreshMailUnread())
      .on("postgres_changes", { event: "*", schema: "public", table: "station_mail_messages" }, () => void refreshMailUnread())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [state.session?.user.id, refreshMailUnread]);

  const refreshWaitingCount = useCallback(async () => {
    const requestId = ++waitingCountRequestRef.current;
    try {
      const response = await fetch(`/api/public/match-status?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok) return;
      const payload = await response.json() as { waiting?: number };
      if (requestId === waitingCountRequestRef.current) {
        setWaitingCount(Number(payload.waiting ?? 0));
      }
    } catch {}
  }, []);

  useEffect(() => {
    void refreshWaitingCount();

    // Immediate refresh when the page becomes active again. Keep polling only as a fallback.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshWaitingCount();
    };
    const onFocus = () => void refreshWaitingCount();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refreshWaitingCount(), 15000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refreshWaitingCount]);

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
      void refreshWaitingCount();
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

        const [loadedProfileResult, queueResult, sessionResult] = await Promise.all([
          loadMyProfile(session.user.id),
          loadMyRandomQueue(session.user.id),
          loadMyActiveRandomSession(),
        ]);

        const profileResult = loadedProfileResult.data || loadedProfileResult.error
          ? loadedProfileResult
          : await ensureAnonymousBootstrapProfile(session.user.id);

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

    if (state.queue?.status === "waiting" && !state.queue.matched_session_id) {
      router.replace("/waiting");
    }
  }, [bootstrapping, pathname, router, state.queue, state.session]);

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

  const renameBusyAny = renameBusy || randomBusy;

  // The rename result always replaces the local profile name with what the RPC
  // returned, so the header, the modal and every later read agree without an F5.
  const applyAnonymousName = (name: string) => {
    setState((prev) => {
      if (prev.profile) {
        return { ...prev, profile: { ...prev.profile, anonymous_display_name: name } };
      }

      if (!prev.session) {
        return prev;
      }

      return {
        ...prev,
        profile: {
          id: prev.session.user.id,
          anonymous_mode_enabled: true,
          anonymous_display_name: name,
          anonymous_avatar: null,
          account_status: null,
        },
      };
    });
    setRenameDraft(name);
    setRenameError(null);
    setRenameNotice(`匿名暱稱已更新為「${name}」`);
  };

  const openRenameDialog = () => {
    setRenameDraft(state.profile?.anonymous_display_name ?? "");
    setRenameError(null);
    setRenameNotice(null);
    setRenameOpen(true);
  };

  const closeRenameDialog = () => {
    if (renameBusyAny) {
      return;
    }

    setRenameOpen(false);
    setRenameError(null);
  };

  const submitRename = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (renameBusyAny) {
      return;
    }

    const invalid = validateAnonymousDisplayNameDraft(renameDraft);
    if (invalid) {
      setRenameNotice(null);
      setRenameError(anonymousRenameErrorMessage(invalid));
      return;
    }

    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await renameAnonymousDisplayName(renameDraft);
      if (!result.ok) {
        setRenameNotice(null);
        setRenameError(result.message);
        return;
      }

      applyAnonymousName(result.name);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const submitRandomRename = async () => {
    if (renameBusyAny) {
      return;
    }

    setRandomBusy(true);
    setRenameError(null);
    try {
      const result = await randomizeAnonymousDisplayName();
      if (!result.ok) {
        setRenameNotice(null);
        setRenameError(result.message);
        return;
      }

      applyAnonymousName(result.name);
    } finally {
      setRandomBusy(false);
    }
  };

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

  const showAbuseBlockMessage = (check: AnonymousAbusePrecheckRow) => {
    if (check.decision === "cooldown") {
      if (check.cooldown_until) {
        const minutes = Math.max(1, Math.ceil((Date.parse(check.cooldown_until) - Date.now()) / 60000));
        setMessage(`配對操作太頻繁，請約 ${minutes} 分鐘後再試。`);
      } else {
        setMessage("配對操作太頻繁，請稍後再試。");
      }
      return;
    }

    if (check.decision === "temporary_suspension") {
      setMessage("帳號暫時停權中，請稍後再試。");
      return;
    }

    setMessage("此帳號目前無法使用配對功能，請稍後再試。");
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
      <main className="stack home-fixed home-premium">
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
      <main className="stack home-fixed home-premium">
        <PageHero
          title="HerLink 網頁版"
          description="缺少後端連線設定，請聯絡管理員。"
        />
        {debugPanel}
      </main>
    );
  }

  if (bootstrapping) {
    return (
      <main className="stack home-fixed home-premium">
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

    // React 的 disabled 狀態更新前仍可能收到極短時間內的重複點擊。
    // 用 ref 做同步鎖，避免同一個瀏覽器一次建立多個匿名 Supabase 帳號。
    if (anonymousStartInFlightRef.current) {
      return;
    }

    anonymousStartInFlightRef.current = true;
    setActionBusy(true);
    setMessage(null);

    try {
      // 先重新向 Supabase 讀一次實際 session。跨分頁、重新整理或
      // bootstrap 狀態尚未同步時，只要瀏覽器已經有 session 就直接沿用。
      const { data: existingSessionData, error: existingSessionError } = await getCurrentSession();
      if (existingSessionError) {
        throw existingSessionError;
      }

      let session = existingSessionData.session ?? null;

      if (!session) {
        const { data, error } = await signInAnonymously();
        if (error) {
          throw error;
        }
        session = data.session ?? null;
      }

      if (!session) {
        throw new Error("匿名登入未建立工作階段");
      }

      const profileResult = await ensureAnonymousBootstrapProfile(session.user.id);
      if (profileResult.error) {
        throw profileResult.error;
      }

      const abuseCheck = await registerAnonymousAbuseIdentity();
      if (abuseCheck.error) {
        throw abuseCheck.error;
      }

      const nextState = {
        session,
        profile: profileResult.data ?? null,
        queue: null,
        activeSession: null,
      };

      setState(nextState);

      if (abuseCheck.data && abuseCheck.data.decision !== "allow") {
        showAbuseBlockMessage(abuseCheck.data);
        return;
      }

      // 完整 reload 能讓首頁 bootstrap 從已持久化的 Supabase session
      // 重新建立一致狀態，避免匿名登入成功但畫面看起來沒有反應。
      window.location.assign("/");
    } catch (error) {
      setMessage(getFriendlyAuthErrorMessage(error, "目前無法建立匿名身份，請稍後再試。"));
    } finally {
      anonymousStartInFlightRef.current = false;
      setActionBusy(false);
    }
  };

  const requestRecovery = async () => {
    if (recoveryBusy || !recoveryName.trim()) return;
    setRecoveryBusy(true);
    setMessage(null);
    try {
      const auth = await signInAnonymously();
      if (auth.error || !auth.data.session) throw auth.error ?? new Error("匿名登入失敗");
      const result = await requestRandomIdentityRecovery(recoveryName);
      if (result.error) throw result.error;
      const row = result.data?.[0];
      if (!row?.recovery_code) throw new Error("恢復碼建立失敗");
      setRecoveryCode(row.recovery_code);
    } catch {
      setMessage("目前無法建立恢復申請，請確認原本的匿名名稱後再試。");
    } finally {
      setRecoveryBusy(false);
    }
  };

  if (!state.session) {
    return (
      <main className="stack home-fixed home-premium">
        <PageHero
          title="HerLink"
          description="不用註冊、不用公開真實資料，直接建立匿名身份開始聊天。"
          actions={
            <>
              <Button size="lg" onClick={startAnonymous} disabled={actionBusy}>
                {actionBusy ? "建立匿名身份中…" : "開始匿名聊天"}
              </Button>
              <Button variant="link" onClick={() => setRecoveryOpen(true)} disabled={actionBusy}>
                無法進入原本聊天室？
              </Button>
              {onlineCountConnected ? <Badge variant="success">在線 {onlineCount} 人</Badge> : null}
              <Badge variant="neutral">排隊 {waitingCount === null ? "更新中…" : `${waitingCount} 人`}</Badge>
            </>
          }
        >
          {message ? <Notice variant="warning">{message}</Notice> : null}
        </PageHero>
        <Modal open={recoveryOpen} title="找回原本聊天室" onClose={() => !recoveryBusy && setRecoveryOpen(false)}>
          <div className="stack">
            <p className="muted">輸入原本使用的匿名名稱，取得 8 碼恢復碼後傳給管理員協助恢復。</p>
            <Field label="原本的匿名名稱" htmlFor="recovery-name">
              <input
                id="recovery-name"
                value={recoveryName}
                onChange={(event) => setRecoveryName(event.target.value)}
                disabled={recoveryBusy || Boolean(recoveryCode)}
                autoComplete="off"
              />
            </Field>
            {recoveryCode ? (
              <Notice variant="success" title="恢復碼已建立">
                <strong style={{ fontSize: 22, letterSpacing: 2 }}>{recoveryCode}</strong>
                <div className="small" style={{ marginTop: 8 }}>請把這組 8 碼傳給管理員。</div>
              </Notice>
            ) : (
              <Button onClick={() => void requestRecovery()} disabled={recoveryBusy || !recoveryName.trim()}>
                {recoveryBusy ? "建立中…" : "取得恢復碼"}
              </Button>
            )}
          </div>
        </Modal>
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

    const femaleOnlyKey = "herlink_female_only_ack_v1";
    if (typeof window !== "undefined" && window.localStorage.getItem(femaleOnlyKey) !== "1") {
      setFemaleOnlyOpen(true);
      return;
    }

    setActionBusy(true);
    setMessage(null);
    try {
      const runAbuseCheck = async (): Promise<AnonymousAbusePrecheckRow | null> => {
        const abuseCheck = await registerAnonymousAbuseIdentity();
        if (abuseCheck.error) {
          throw abuseCheck.error;
        }

        if (abuseCheck.data && abuseCheck.data.decision !== "allow") {
          return abuseCheck.data;
        }

        return null;
      };

      const abuseBlock = await runAbuseCheck();
      if (abuseBlock) {
        showAbuseBlockMessage(abuseBlock);
        return;
      }

      // Do not keep showing a stale "0" while matchmaking mutates the queue.
      setWaitingCount(null);
      const { data, error } = await findOrJoinRandomMatch();
      void refreshWaitingCount();
      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (result?.status === "limit_reached") {
        setMessage("目前已保留 3 個聊天室，請先結束其中一個再配對新的人。");
        return;
      }

      // Always show the matching screen first. The waiting page owns the
      // transition into a newly matched session, so an immediate backend match
      // cannot look like the home button reopened an old chat.
      if (result?.status === "matched" && result.session_id) {
        router.replace(`/waiting?matched=${encodeURIComponent(result.session_id)}`);
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
      void refreshWaitingCount();
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

  const shareBrowserHandoff = async () => {
    if (!state.session) return;
    const nextPath = state.activeSession?.id ? `/session/${state.activeSession.id}` : "/";
    const handoffUrl = buildBrowserHandoffUrl(state.session, nextPath);
    if (!handoffUrl) return;

    try {
      await navigator.clipboard.writeText(handoffUrl);
      setMessage("已複製續聊連結。請貼到 Chrome、Safari 或其他瀏覽器開啟，會保留匿名名稱與目前聊天。");
    } catch {
      setMessage("無法自動複製續聊連結，請改用目前瀏覽器繼續聊天。");
    }
  };


  const confirmFemaleOnly = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("herlink_female_only_ack_v1", "1");
    }
    setFemaleOnlyOpen(false);
    void startMatching();
  };

  return (
    <main className="home-fixed home-premium home-app-like">
      <section className="home-app-hero">
        <div className="home-app-motion" aria-hidden="true">
          <div className="home-app-glow home-app-glow-a" />
          <div className="home-app-glow home-app-glow-b" />

          <div className="home-app-sparkles">
            <span className="home-app-sparkle home-app-sparkle-a">✦</span>
            <span className="home-app-sparkle home-app-sparkle-b">✧</span>
            <span className="home-app-sparkle home-app-sparkle-c">✦</span>
            <span className="home-app-sparkle home-app-sparkle-d">✧</span>
          </div>

          <div className="home-app-heart home-app-heart-a">♥</div>
          <div className="home-app-heart home-app-heart-b">♥</div>

          <div className="home-app-light-card home-app-light-card-a">
            <span className="home-app-light-dot" />
            <span className="home-app-light-dot" />
            <span className="home-app-light-dot" />
          </div>

          <div className="home-app-light-card home-app-light-card-b">
            <span className="home-app-light-line short" />
            <span className="home-app-light-line" />
          </div>
        </div>

        <button type="button" className="home-mailbox-float" aria-label="信箱" onPointerDown={(event)=>event.currentTarget.blur()} onClick={()=>router.push("/mailbox")}><span className="home-mailbox-icon" aria-hidden="true">✉</span><span>信箱</span>{mailUnreadCount>0?<span className="home-mailbox-unread" aria-label={`${mailUnreadCount} 封未讀`}>{mailUnreadCount>99?"99+":mailUnreadCount}</span>:null}</button>

        {state.profile?.anonymous_display_name === "孤星企鵝" ? <div className="halloween-home-decor" aria-hidden="true"><span>🎃</span><span>👻</span><span>🦇</span></div> : null}
        <div className="home-app-eyebrow">HerLink</div>
        <h1 className="home-app-title">匿名聊天</h1>
        <p className="home-app-copy">不公開個人檔案，不做交友滑卡，只保留匿名隨機配對與聊天室。</p>

        <div className="home-app-identity">
          <div>
            <div className="home-app-label">你的匿名名稱</div>
            <div className="home-app-name">{anonymousSummary?.name ?? "匿名使用者"}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={openRenameDialog} disabled={renameBusyAny}>
            更換
          </Button>
        </div>

        <div className="home-app-actions">
          <Button size="lg" onClick={startMatching} disabled={actionBusy || MAINTENANCE_MODE}>
            {actionBusy ? "處理中…" : MAINTENANCE_MODE ? "維護中" : state.activeSession ? "配對新的人" : "開始匿名配對"}
          </Button>
          {state.activeSession ? <Button variant="secondary" size="lg" href="/chats">我的聊天</Button> : null}
          <Button variant="secondary" size="lg" href="/contacts">匿名聯絡人</Button>
        </div>

        {state.queue?.status === "waiting" ? (
          <div className="home-app-status">
            <span>正在等待配對中</span>
            <Button variant="secondary" size="sm" onClick={leaveQueue} disabled={actionBusy}>取消等待</Button>
          </div>
        ) : null}

        {message ? <Notice variant="warning">{message}</Notice> : null}
        {renameNotice ? <div className="muted small">{renameNotice}</div> : null}
      </section>

      <footer className="home-app-footer">
        <div className="home-app-presence">
          {onlineCountConnected ? (
            <span className="home-app-presence-item"><span className="home-app-presence-dot" />正在出沒 <strong>{onlineCount}</strong> 人</span>
          ) : null}
          <span className="home-app-presence-item"><span className="home-app-wait-dot" />等人來聊 <strong>{waitingCount === null ? "…" : waitingCount}</strong> 人</span>
        </div>
        <div className="home-app-footer-links">
          <Button variant="link" type="button" onClick={() => void shareBrowserHandoff()}>
            跨瀏覽器續聊
          </Button>
          <span className="home-app-footer-sep" aria-hidden="true">·</span>
          <Button variant="link" onClick={logout} disabled={actionBusy}>登出</Button>
        </div>
      </footer>

      <Modal
        open={femaleOnlyOpen}
        title="女性限定聊天室"
        className="female-only-modal"
        onClose={() => setFemaleOnlyOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFemaleOnlyOpen(false)}>取消</Button>
            <Button type="button" onClick={confirmFemaleOnly}>我符合資格</Button>
          </>
        }
      >
        <p className="hero-copy">HerLink 匿名聊天室僅限女性使用。</p>
        <p className="muted small">請確認你符合使用資格。若冒充或違反規則，可能會被檢舉、封鎖或停用配對功能。</p>
      </Modal>

      <Modal open={renameOpen} title="匿名暱稱" onClose={closeRenameDialog} className="rename-modal">
        <form className="rename-form" onSubmit={(event) => void submitRename(event)}>
          <div className="muted small">目前使用：{anonymousSummary?.name ?? "匿名使用者"}</div>
          <Field
            label="匿名暱稱"
            htmlFor="anonymous-display-name"
            hint="2–12 個字，名稱不可重複"
            error={renameError}
          >
            <input
              id="anonymous-display-name"
              className="input"
              type="text"
              name="anonymous-display-name"
              value={renameDraft}
              onChange={(event) => {
                setRenameDraft(event.target.value);
                setRenameError(null);
              }}
              placeholder="輸入匿名名稱"
              maxLength={ANONYMOUS_DISPLAY_NAME_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={renameBusyAny}
            />
          </Field>
          <div className="modal-actions">
            <Button type="submit" size="md" disabled={renameBusyAny}>
              {renameBusy ? "儲存中…" : "使用這個名稱"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void submitRandomRename()}
              disabled={renameBusyAny}
            >
              {randomBusy ? "產生中…" : "隨機一個"}
            </Button>
          </div>
        </form>
      </Modal>

      {debugPanel}
    </main>
  );
}
