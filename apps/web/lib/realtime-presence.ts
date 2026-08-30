"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type PresenceState = Record<string, unknown[]>;

function getUniquePresenceCount(channel: { presenceState?: () => PresenceState }) {
  const state = channel.presenceState?.() ?? {};
  return Object.keys(state).length;
}

export function useOnlinePresence(userId: string | null | undefined) {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!userId) {
      setOnlineCount(null);
      setConnected(false);
      return;
    }

    let mounted = true;
    const channel = supabase.channel("herlink-online-users", {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    const syncCount = () => {
      if (!mounted) return;
      setOnlineCount(getUniquePresenceCount(channel));
    };

    channel.on("presence", { event: "sync" }, syncCount);
    channel.on("presence", { event: "join" }, syncCount);
    channel.on("presence", { event: "leave" }, syncCount);

    channel.subscribe(async (status: string) => {
      if (!mounted) return;

      if (status === "SUBSCRIBED") {
        setConnected(true);
        try {
          await channel.track({});
        } catch {
          // Keep the hook resilient; the next sync/leave/join will correct the count.
        }
        syncCount();
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "CLOSED") {
        setConnected(false);
      }
    });

    return () => {
      mounted = false;
      setConnected(false);
      setOnlineCount(null);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return { onlineCount, onlineCountConnected: connected && onlineCount !== null };
}
