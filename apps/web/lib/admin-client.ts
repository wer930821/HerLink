"use client";

import { useEffect, useState } from "react";
import { getCurrentSession, type Session } from "./supabase";

export function useAdminSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data } = await getCurrentSession();
      if (!mounted) {
        return;
      }

      setSession(data.session ?? null);
      setLoading(false);
    }

    void loadSession();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    session,
    loading,
    accessToken: session?.access_token ?? null,
  };
}

export async function fetchAdminJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = { message: raw };
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : `Admin request failed (${response.status})`;
    const error = new Error(message) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload as T;
}
