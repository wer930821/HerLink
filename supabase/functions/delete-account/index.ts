import { createClient } from "npm:@supabase/supabase-js@2";

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

async function requireUser(req: Request, supabaseAdmin: ReturnType<typeof buildAdminClient>) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    throw new Error("Missing bearer token.");
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error("Unauthorized.");
  }

  return {
    accessToken,
    userId: data.user.id,
    email: data.user.email ?? null,
  };
}

async function listPaths(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  table: "profile_photos" | "verifications",
  userId: string,
  column: "storage_path" | "media_path"
) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(column)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((row) => row[column])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

async function removeBucketPaths(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  bucket: string,
  paths: string[]
) {
  if (paths.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
  if (error) {
    throw error;
  }

  return paths.length;
}

async function markDeletionPending(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  userId: string
) {
  const { error } = await supabaseAdmin.rpc("request_account_deletion");
  if (!error) {
    return;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,account_status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    return;
  }

  if (profile.account_status !== "deletion_pending") {
    await supabaseAdmin
      .from("profiles")
      .update({
        account_status: "deletion_pending",
        deletion_requested_at: new Date().toISOString(),
      })
      .eq("id", userId);
  }
}

async function ensureDeletionPending(
  supabaseAdmin: ReturnType<typeof buildAdminClient>,
  userId: string,
  accessToken: string
) {
  const scopedClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );

  const { error } = await scopedClient.rpc("request_account_deletion");
  if (!error) {
    return;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,account_status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    return;
  }

  if (profile.account_status !== "deletion_pending") {
    throw error;
  }
}

export default {
  fetch: async (req: Request) => {
    try {
      const supabaseAdmin = buildAdminClient();
      const { accessToken, userId } = await requireUser(req, supabaseAdmin);

      await ensureDeletionPending(supabaseAdmin, userId, accessToken);

      const [photoPaths, verificationPaths] = await Promise.all([
        listPaths(supabaseAdmin, "profile_photos", userId, "storage_path"),
        listPaths(supabaseAdmin, "verifications", userId, "media_path"),
      ]);

      const deletedProfilePhotoCount = await removeBucketPaths(
        supabaseAdmin,
        "profile-photos",
        photoPaths
      );
      const deletedVerificationMediaCount = await removeBucketPaths(
        supabaseAdmin,
        "verification-private",
        verificationPaths
      );

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
      if (deleteError) {
        throw deleteError;
      }

      return json({
        ok: true,
        deleted: true,
        userId,
        deletedAuthUser: true,
        deletedProfilePhotoCount,
        deletedVerificationMediaCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(
        {
          ok: false,
          error: message,
        },
        500
      );
    }
  },
};
