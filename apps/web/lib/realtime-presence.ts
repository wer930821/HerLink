"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

const ONLINE_HEARTBEAT_MS = 60_000;
const ONLINE_COUNT_REFRESH_MS = 120_000;
const ONLINE_RESUME_DEDUPE_MS = 5_000;
const ONLINE_INSTANCE_STORAGE_KEY = "herlink:web-online-instance-id";

function getOnlineInstanceId() {
  const existing = window.sessionStorage.getItem(ONLINE_INSTANCE_STORAGE_KEY);
  if (existing) return existing;

  const instanceId = window.crypto.randomUUID();
  window.sessionStorage.setItem(ONLINE_INSTANCE_STORAGE_KEY, instanceId);
  return instanceId;
}

export function useOnlinePresence(userId: string | null | undefined) {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const instanceIdRef = useRef<string | null>(null);
  const lastHeartbeatRef = useRef(0);
  const lastCountRefreshRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      setOnlineCount(null);
      setConnected(false);
      lastHeartbeatRef.current = 0;
      lastCountRefreshRef.current = 0;
      return;
    }

    let mounted = true;
    let syncing = false;
    const instanceId = instanceIdRef.current ?? getOnlineInstanceId();
    instanceIdRef.current = instanceId;

    const syncPresence = async (forceCount = false) => {
      if (!mounted || syncing) return;
      if (Date.now() - lastHeartbeatRef.current < ONLINE_RESUME_DEDUPE_MS) return;

      syncing = true;
      try {
        const heartbeat = await supabase.rpc("touch_online_activity", { p_instance_id: instanceId });
        if (heartbeat.error) throw heartbeat.error;
        lastHeartbeatRef.current = Date.now();

        const shouldRefreshCount =
          forceCount || Date.now() - lastCountRefreshRef.current < ONLINE_COUNT_REFRESH_MS === false;
        if (shouldRefreshCount) {
          const count = await supabase.rpc("get_online_user_count");
          if (count.error) throw count.error;
          lastCountRefreshRef.current = Date.now();
          if (mounted) setOnlineCount(typeof count.data === "number" ? count.data : null);
        }

        if (mounted) setConnected(true);
      } catch {
        if (mounted) {
          setOnlineCount(null);
          setConnected(false);
        }
      } finally {
        syncing = false;
      }
    };

    void syncPresence(true);
    const interval = window.setInterval(() => void syncPresence(), ONLINE_HEARTBEAT_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncPresence();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mounted = false;
      setConnected(false);
      setOnlineCount(null);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId]);

  return { onlineCount, onlineCountConnected: connected && onlineCount !== null };
}
