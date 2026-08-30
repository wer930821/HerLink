"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

  useEffect(() => {
    let mounted = true;

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
    if (!userId) return;

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
    if (!loading && (!profile || !isAnonymousProfileReady(profile))) {
      router.replace("/onboarding");
    }
  }, [loading, profile, router]);

  useEffect(() => {
    if (!loading && session) {
      router.replace(`/session/${session.id}`);
    }
  }, [loading, router, session]);

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
        <h1 className="hero-title">正在尋找聊天對象…</h1>
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
