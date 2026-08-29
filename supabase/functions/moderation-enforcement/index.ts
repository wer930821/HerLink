import { createClient } from "npm:@supabase/supabase-js@2";
import { hashCredentialEmail } from "../_shared/enforcement.ts";

type EnforcementType = "warning" | "temporary_suspension" | "permanent_ban";

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

async function ensureAuthorized(req: Request, supabaseAdmin: ReturnType<typeof buildAdminClient>) {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const bearer = authHeader.slice("Bearer ".length).trim();
  if (!bearer) {
    throw new Error("Missing bearer token.");
  }

  if (serviceRoleKey && bearer === serviceRoleKey) {
    return { kind: "service_role" as const, userId: null };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(bearer);
  if (error || !data.user) {
    throw new Error("Unauthorized.");
  }

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("admin_users")
    .select("role,active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminError) {
    throw adminError;
  }

  if (!adminRow || !["moderator", "admin"].includes(adminRow.role)) {
    throw new Error("Forbidden.");
  }

  return { kind: "admin" as const, userId: data.user.id };
}

function normalizeEnforcementType(value: string): EnforcementType {
  if (value === "warning" || value === "temporary_suspension" || value === "permanent_ban") {
    return value;
  }
  throw new Error("Unsupported enforcement type.");
}

function buildExpiry(body: { expiresAt?: string | null; durationHours?: number | null }) {
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    return new Date(body.expiresAt).toISOString();
  }

  if (typeof body.durationHours === "number" && Number.isFinite(body.durationHours) && body.durationHours > 0) {
    return new Date(Date.now() + body.durationHours * 60 * 60 * 1000).toISOString();
  }

  return null;
}

async function loadCredentialHash(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  subjectUserId: string
) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(subjectUserId);
  if (error || !data.user?.email) {
    throw error ?? new Error("Unable to load subject auth user.");
  }

  return hashCredentialEmail(data.user.email);
}

async function loadLatestIpHash(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  credentialHash: string | null
) {
  if (!credentialHash) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("signup_precheck_events")
    .select("ip_hash")
    .eq("credential_hash", credentialHash)
    .not("ip_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.ip_hash ?? null;
}

export default {
  fetch: async (req: Request) => {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    try {
      const supabaseAdmin = buildAdminClient();
      await ensureAuthorized(req, supabaseAdmin);
      const body = await req.json();
      const subjectUserId = typeof body?.subjectUserId === "string" ? body.subjectUserId.trim() : "";
      const reasonCode = typeof body?.reasonCode === "string" ? body.reasonCode.trim() : null;
      const enforcementType = normalizeEnforcementType(String(body?.enforcementType ?? ""));

      if (!subjectUserId) {
        throw new Error("subjectUserId is required.");
      }

      const expiry = enforcementType === "temporary_suspension" ? buildExpiry(body) : null;
      const credential = await loadCredentialHash(supabaseAdmin, subjectUserId);
      const ipHash = await loadLatestIpHash(supabaseAdmin, credential.hash);

      const { data, error } = await supabaseAdmin
        .from("moderation_enforcements")
        .insert({
          subject_user_id: subjectUserId,
          enforcement_type: enforcementType,
          reason_code: reasonCode,
          status: "active",
          credential_hash: credential.hash,
          ip_hash: ipHash,
          expires_at: expiry,
        })
        .select("id,enforcement_type,status,credential_hash,ip_hash,expires_at")
        .single();

      if (error) {
        throw error;
      }

      if (enforcementType === "temporary_suspension" || enforcementType === "permanent_ban") {
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ account_status: "suspended" })
          .eq("id", subjectUserId);
        if (updateError) {
          throw updateError;
        }
      }

      return json({
        ok: true,
        enforcement: data,
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
