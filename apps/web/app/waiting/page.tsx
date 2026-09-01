"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOnlinePresence } from "../../lib/realtime-presence";
import { MAINTENANCE_MESSAGE, MAINTENANCE_MODE, MAINTENANCE_TITLE } from "../../lib/site-config";
import {
  isAnonymousProfileReady,
  leaveRandomQueue,
  loadMyActiveRandomSession,
  loadMyProfile,
  loadMyRandomQueue,
  supabase,
  type RandomQueueRow,
  type RandomSessionRow,
  type WebProfile,
} from "../../lib/supabase";

type RealtimePayload<T> = {
  new: T;
};

export default function WaitingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<WebProfile | null>(null);
  const [queue, setQueue] = useState<RandomQueueRow | null>(null);
  const [session, setSession] = useState<RandomSessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const waitingMountedAtRef = useRef<number>(Date.now());
  const waitingStartedAtRef = useRef<number | null>(null);
  const { onlineCount } = useOnlinePresence(userId);

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

        const [profileResult, queueResult, sessionResult] = await Promise.all([
          loadMyProfile(sessionData.user.id),
          loadMyRandomQueue(sessionData.user.id),
          loadMyActiveRandomSession(),
        ]);

        if (!mounted) return;

        setUserId(sessionData.user.id);
        setProfile(profileResult.data ?? null);
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
          if (nextQueue.status === "matched" && nextQueue.matched_session_id) {
            router.replace(`/session/${nextQueue.matched_session_id}`);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  useEffect(() => {
    if (MAINTENANCE_MODE) return;

    if (!loading && (!profile || !isAnonymousProfileReady(profile))) {
      router.replace("/onboarding");
    }
  }, [loading, profile, router]);

  useEffect(() => {
    if (MAINTENANCE_MODE) return;

    if (!loading && session) {
      router.replace(`/session/${session.id}`);
    }
  }, [loading, router, session]);

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

  if (MAINTENANCE_MODE) {
    return (
      <main className="stack">
        <section className="hero">
          <div className="status-badge accent">
            維護中
          </div>
          <h1 className="hero-title">{MAINTENANCE_TITLE}</h1>
          <p className="hero-copy">{MAINTENANCE_MESSAGE}</p>
          <div className="notice">
            目前不開放新的等待配對。若你已經在匿名對話中，現有聊天室不會被強制關閉。
          </div>
          <div className="row">
            <button className="ghost" onClick={() => router.replace("/")}>
              返回首頁
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="hero">
        <h1 className="hero-title">正在尋找聊天對象…</h1>
        <p className="hero-copy">請先保持頁面開啟，配對成功後會自動跳轉。</p>
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
      <section className="hero">
        <h1 className="hero-title waiting-title">{waitingTitle}</h1>
        <div className="waiting-meta">
          <div className="muted">已等待 {formattedElapsed}</div>
          <div className="muted small">目前在線 {onlineCount ?? 0} 人</div>
        </div>
        <p className="hero-copy">系統會自動把你配對給另一位等待中的匿名使用者。</p>
        {profile ? (
          <div className="row">
            <div>
              <div className="title">{profile.anonymous_display_name ?? "匿名使用者"}</div>
              <div className="muted small">你目前在等待池中</div>
            </div>
          </div>
        ) : null}
        <div className="row">
          <button className="button secondary" onClick={cancelWaiting} disabled={actionBusy}>
            取消配對
          </button>
          <button className="ghost" onClick={() => router.replace("/")}>
            返回首頁
          </button>
        </div>
      </section>
    </main>
  );
}
