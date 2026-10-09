"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markRandomSessionRead } from "../../lib/supabase";

const READ_MARK_DEBOUNCE_MS = 1500;

function getSessionId(pathname: string) {
  const match = pathname.match(/^\/session\/([0-9a-f-]{36})(?:\/|$)/i);
  return match?.[1] ?? null;
}

export function SessionReadTracker() {
  const pathname = usePathname();
  const sessionId = getSessionId(pathname);
  const markingRef = useRef(false);
  const queuedRef = useRef(false);
  const lastMarkedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const markVisibleSessionRead = useCallback(async () => {
    if (!sessionId || document.visibilityState !== "visible") return;

    const elapsed = Date.now() - lastMarkedAtRef.current;
    if (elapsed < READ_MARK_DEBOUNCE_MS) {
      if (timerRef.current === null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void markVisibleSessionRead();
        }, READ_MARK_DEBOUNCE_MS - elapsed);
      }
      return;
    }

    if (markingRef.current) {
      queuedRef.current = true;
      return;
    }

    markingRef.current = true;
    lastMarkedAtRef.current = Date.now();
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

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId, markVisibleSessionRead]);

  return null;
}
