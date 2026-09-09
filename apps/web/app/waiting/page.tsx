"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOnlinePresence } from "../../lib/realtime-presence";
import { MAINTENANCE_MESSAGE, MAINTENANCE_MODE, MAINTENANCE_TITLE } from "../../lib/site-config";
import {
  leaveRandomQueue,
  loadMyActiveRandomSession,
  loadMyRandomQueue,
  supabase,
  type RandomQueueRow,
  type RandomSessionRow,
} from "../../lib/supabase";
import { Badge, Button, Notice, PageHero } from "../../components/ui";
import { PushPermissionCard } from "../../components/push/PushPermissionCard";

type RealtimePayload<T> = {
  new: T;
};

export default function WaitingPage() {
  const router = useRouter();
  const [debug, setDebug] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [queue, setQueue] = useState<RandomQueueRow | null>(null);
  const [session, setSession] = useState<RandomSessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const waitingMountedAtRef = useRef<number>(Date.now());
  const waitingStartedAtRef = useRef<number | null>(null);
  const { onlineCount } = useOnlinePresence(userId);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  const waitingTitle = useMemo(() => {
    if (elapsedSeconds >= 30) {
      return (
        <>
          還在幫你找人，再等等看 <span className="waiting-eyes" aria-hidden="true">👀</span>
        </>
      );
    }

    return "正在尋找聊天對象…";
  }, [elapsedSeconds]);

  const formattedElapsed = useMemo(() => {
    const totalSeconds = Math.max(0, elapsedSeconds);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsedSeconds]);

  useEffect(() => {
    let mounted = true;

    if (MAINTENANCE_MODE) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    async function bootstrap() {
      try {
        const { data } = await supabase.auth.getSession();
        const sessionData = data.session;
        if (!sessionData) {
          router.replace("/");
          return;
        }

        const [queueResult, sessionResult] = await Promise.all([
          loadMyRandomQueue(sessionData.user.id),
          loadMyActiveRandomSession(),
        ]);

        if (!mounted) return;

        setUserId(sessionData.user.id);
        setQueue(queueResult.data ?? null);
        setSession(sessionResult.data ?? null);
      } catch {
        if (mounted) {
          router.replace("/");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (MAINTENANCE_MODE || !userId) return;

    const channel = supabase
      .channel(`random-queue-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "random_match_queue",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePayload<RandomQueueRow>) => {
          const nextQueue = payload.new as RandomQueueRow;
          setQueue(nextQueue);
          if (!debug && nextQueue.status === "matched" && nextQueue.matched_session_id) {
            router.replace(`/session/${nextQueue.matched_session_id}`);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [debug, router, userId]);

  useEffect(() => {
    if (MAINTENANCE_MODE || !userId) return;

    let mounted = true;
    let syncing = false;
    const syncMatchState = async () => {
      if (!mounted || syncing) return;
      syncing = true;
      try {
        const [queueResult, sessionResult] = await Promise.all([
          loadMyRandomQueue(userId),
          loadMyActiveRandomSession(),
        ]);
        if (!mounted) return;

        if (!queueResult.error) setQueue(queueResult.data ?? null);
        if (!sessionResult.error) setSession(sessionResult.data ?? null);

        const matchedSessionId = queueResult.data?.status === "matched"
          ? queueResult.data.matched_session_id
          : null;
        if (!debug && (sessionResult.data?.id ?? matchedSessionId)) {
          router.replace(`/session/${sessionResult.data?.id ?? matchedSessionId}`);
        }
      } finally {
        syncing = false;
      }
    };

    void syncMatchState();
    const interval = window.setInterval(() => void syncMatchState(), 5_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [debug, router, userId]);

  useEffect(() => {
    if (MAINTENANCE_MODE) return;

    if (!debug && !loading && session) {
      router.replace(`/session/${session.id}`);
    }
  }, [debug, loading, router, session]);

  useEffect(() => {
    if (MAINTENANCE_MODE || loading || session) {
      waitingStartedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    if (queue && (queue.status !== "waiting" || queue.matched_session_id)) {
      waitingStartedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    const parsedJoinedAt = queue?.joined_at ? Date.parse(queue.joined_at) : Number.NaN;
    const startAt = Number.isFinite(parsedJoinedAt) ? parsedJoinedAt : waitingMountedAtRef.current;
    waitingStartedAtRef.current = startAt;

    const syncElapsed = () => {
      const startedAt = waitingStartedAtRef.current ?? startAt;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };

    syncElapsed();
    const interval = window.setInterval(syncElapsed, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loading, queue?.joined_at, queue?.matched_session_id, queue?.status, session]);

  const debugDiagnostics = debug && userId ? <PushPermissionCard forceDebug /> : null;

  if (MAINTENANCE_MODE) {
    return (
      <main className="stack">
        <PageHero
          kicker={<Badge variant="accent">維護中</Badge>}
          title={MAINTENANCE_TITLE}
          description={MAINTENANCE_MESSAGE}
          actions={<Button variant="ghost" onClick={() => router.replace("/")}>返回首頁</Button>}
        >
          <Notice>
            目前不開放新的等待配對。若你已經在匿名對話中，現有聊天室不會被強制關閉。
          </Notice>
        </PageHero>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="stack">
        <PageHero title="正在尋找聊天對象…" description="請先保持頁面開啟，配對成功後會自動跳轉。" />
        {debugDiagnostics}
      </main>
    );
  }

  const cancelWaiting = async () => {
    setActionBusy(true);
    try {
      await leaveRandomQueue();
      router.replace("/");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <main className="stack">
      <PageHero
        title={<span className="waiting-title">{waitingTitle}</span>}
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={cancelWaiting} disabled={actionBusy}>
              取消配對
            </Button>
            <Button variant="ghost" size="lg" onClick={() => router.replace("/")}>
              返回首頁
            </Button>
          </>
        }
      >
        <div className="waiting-meta">
          <div className="muted">已等待 {formattedElapsed}</div>
          <div className="muted small">目前有 {onlineCount ?? 0} 位使用者在線（不代表都在等待配對）</div>
        </div>
        <p className="hero-copy">系統會自動把你配對給另一位等待中的匿名使用者。</p>
      </PageHero>
      {debug ? debugDiagnostics : <PushPermissionCard />}
    </main>
  );
}
