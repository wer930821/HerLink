"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markRandomSessionRead, supabase } from "../../lib/supabase";

function getSessionId(pathname: string) {
  const match = pathname.match(/^\/session\/([0-9a-f-]{36})(?:\/|$)/i);
  return match?.[1] ?? null;
}

export function SessionReadTracker() {
  const pathname = usePathname();
  const sessionId = getSessionId(pathname);
  const markingRef = useRef(false);
  const queuedRef = useRef(false);

  const markVisibleSessionRead = useCallback(async () => {
    if (!sessionId || document.visibilityState !== "visible") return;
    if (markingRef.current) {
      queuedRef.current = true;
      return;
    }
    markingRef.current = true;
    try {
      await markRandomSessionRead(sessionId);
    } finally {
      markingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        void markVisibleSessionRead();
      }
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void markVisibleSessionRead();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void markVisibleSessionRead();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const channel = supabase
      .channel(`session-read-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "random_chat_messages", filter: `session_id=eq.${sessionId}` },
        () => {
          if (document.visibilityState === "visible") void markVisibleSessionRead();
        }
      )
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, markVisibleSessionRead]);

  return null;
}
