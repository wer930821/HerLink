import { createClient } from "npm:@supabase/supabase-js@2";
import { getRequestIp, hashCredentialEmail, hashIpAddress, normalizeEmail } from "../_shared/enforcement.ts";

type Decision = "allow" | "needs_review" | "block" | "rate_limited";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function buildAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase function environment.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  });
}

function parseRateLimit(name: string, fallback: number) {
  const value = Number(Deno.env.get(name) ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isActiveEnforcement(row: { status: string; revoked_at: string | null; expires_at: string | null }) {
  if (row.status !== "active" || row.revoked_at) {
    return false;
  }

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return false;
  }

  return true;
}

function validateEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new Error("Email is required.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email.");
  }

  return normalized;
}

async function logAttempt(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  payload: {
    credentialHash: string | null;
    ipHash: string | null;
    decision: Decision;
    reasonCode: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await supabaseAdmin.from("signup_precheck_events").insert({
    credential_hash: payload.credentialHash,
    ip_hash: payload.ipHash,
    decision: payload.decision,
    reason_code: payload.reasonCode,
    metadata: payload.metadata ?? {},
  });

  if (error) {
    throw error;
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    try {
      const supabaseAdmin = buildAdminClient();
      const body = await req.json().catch(() => ({}));
      const normalizedEmail = validateEmail(typeof body?.email === "string" ? body.email : "");
      const requestIp = getRequestIp(req);
      const credential = await hashCredentialEmail(normalizedEmail);
      const ip = await hashIpAddress(requestIp);
      const hourlyLimit = parseRateLimit("HERLINK_SIGNUP_HOURLY_LIMIT", 5);
      const dailyLimit = parseRateLimit("HERLINK_SIGNUP_DAILY_LIMIT", 12);

      const [credentialMatches, ipMatches, recentIpAttempts] = await Promise.all([
        credential.hash
          ? supabaseAdmin
              .from("moderation_enforcements")
              .select("enforcement_type,status,expires_at,revoked_at")
              .eq("credential_hash", credential.hash)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        ip.hash
          ? supabaseAdmin
              .from("moderation_enforcements")
              .select("enforcement_type,status,expires_at,revoked_at,credential_hash")
              .eq("ip_hash", ip.hash)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        ip.hash
          ? supabaseAdmin
              .from("signup_precheck_events")
              .select("decision,created_at")
              .eq("ip_hash", ip.hash)
              .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (credentialMatches.error) throw credentialMatches.error;
      if (ipMatches.error) throw ipMatches.error;
      if (recentIpAttempts.error) throw recentIpAttempts.error;

      const activeCredentialEnforcements = (credentialMatches.data ?? []).filter(isActiveEnforcement);
      const activeIpEnforcements = (ipMatches.data ?? []).filter(isActiveEnforcement);
      const recentIpEvents = recentIpAttempts.data ?? [];
      const recentIpHourlyEvents = recentIpEvents.filter(
        (row) => new Date(row.created_at).getTime() >= Date.now() - 60 * 60 * 1000
      );
      const recentIpHourlyCount = recentIpHourlyEvents.length;
      const recentIpDailyCount = recentIpEvents.length;

      let decision: Decision = "allow";
      let reasonCode: string | null = null;

      const permanentCredentialBan = activeCredentialEnforcements.find(
        (row) => row.enforcement_type === "permanent_ban"
      );
      const temporaryCredentialBan = activeCredentialEnforcements.find(
        (row) => row.enforcement_type === "temporary_suspension"
      );

      if (permanentCredentialBan) {
        decision = "block";
        reasonCode = "permanent_ban";
      } else if (temporaryCredentialBan) {
        decision = "block";
        reasonCode = "temporary_suspension";
      } else if (recentIpHourlyCount >= hourlyLimit || recentIpDailyCount >= dailyLimit) {
        decision = "rate_limited";
        reasonCode = "signup_rate_limited";
      } else {
        const ipPermanentSignals = activeIpEnforcements.filter(
          (row) => row.enforcement_type === "permanent_ban"
        );
        const ipTemporarySignals = activeIpEnforcements.filter(
          (row) => row.enforcement_type === "temporary_suspension"
        );
        const recentBlockedSignals = recentIpEvents.filter(
          (row) => row.decision === "block" || row.decision === "rate_limited"
        ).length;
        const recentHourlyBlockedSignals = recentIpHourlyEvents.filter(
          (row) => row.decision === "block" || row.decision === "rate_limited"
        ).length;
        const hasSharedIpEnforcement = ipPermanentSignals.length > 0 || ipTemporarySignals.length > 0;

        if (hasSharedIpEnforcement && recentHourlyBlockedSignals >= 2) {
          decision = "needs_review";
          reasonCode = "shared_ip_risk";
        } else if (recentBlockedSignals >= 2) {
          decision = "needs_review";
          reasonCode = "signup_flood_risk";
        }
      }

      await logAttempt(supabaseAdmin, {
        credentialHash: credential.hash,
        ipHash: ip.hash,
        decision,
        reasonCode,
        metadata: {
          has_ip: Boolean(ip.hash),
          hourly_count: recentIpHourlyCount,
          daily_count: recentIpDailyCount,
        },
      });

      return json({
        ok: true,
        decision,
        reasonCode,
      });
    } catch (error) {
      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  },
};
