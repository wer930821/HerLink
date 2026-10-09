import { supabase } from "./lib/supabase";

// Next.js loads instrumentation-client.ts once in the browser before the app
// becomes interactive. Coalesce only concurrent session-view RPCs; do not cache
// completed results, because active/ended state must remain immediately fresh.
const sessionViewInFlight = new Map<string, Promise<unknown>>();
const originalRpc = supabase.rpc.bind(supabase);

supabase.rpc = (name: string, params?: Record<string, unknown>, options?: unknown) => {
  if (name !== "get_my_random_session_view") {
    return originalRpc(name, params, options);
  }

  const sessionId = typeof params?.p_session_id === "string" ? params.p_session_id : "__active__";
  const key = `${name}:${sessionId}`;
  const existing = sessionViewInFlight.get(key);
  if (existing) return existing;

  const request = Promise.resolve(originalRpc(name, params, options)).finally(() => {
    sessionViewInFlight.delete(key);
  });
  sessionViewInFlight.set(key, request);
  return request;
};
