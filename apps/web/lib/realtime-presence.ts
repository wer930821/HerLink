"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

const ONLINE_HEARTBEAT_MS = 30_000;
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

  useEffect(() => {
    if (!userId) {
      setOnlineCount(null);
      setConnected(false);
      return;
    }

    let mounted = true;
    let syncing = false;
    const instanceId = instanceIdRef.current ?? getOnlineInstanceId();
    instanceIdRef.current = instanceId;

    const syncCount = async () => {
      if (!mounted || syncing) return;
      syncing = true;
      try {
        const heartbeat = await supabase.rpc("touch_online_activity", { p_instance_id: instanceId });
        if (heartbeat.error) throw heartbeat.error;

        const count = await supabase.rpc("get_online_user_count");
        if (count.error) throw count.error;

        if (mounted) {
          setOnlineCount(typeof count.data === "number" ? count.data : null);
          setConnected(true);
        }
      } catch {
        if (mounted) {
          setOnlineCount(null);
          setConnected(false);
        }
      } finally {
        syncing = false;
      }
    };

    void syncCount();
    const interval = window.setInterval(() => void syncCount(), ONLINE_HEARTBEAT_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncCount();
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
