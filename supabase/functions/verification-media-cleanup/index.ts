import { withSupabase } from "npm:@supabase/server";

interface CleanupVerificationRow {
  id: string;
  user_id: string;
  status: string;
  media_path: string | null;
  media_delete_after: string | null;
  metadata: Record<string, unknown> | null;
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (_req: Request, ctx: { supabaseAdmin: any }) => {
    const now = new Date().toISOString();

    const { data: verifications, error: selectError } = await ctx.supabaseAdmin
      .from("verifications")
      .select("id,user_id,status,media_path,media_delete_after,metadata")
      .in("status", ["verified", "rejected"])
      .not("media_path", "is", null)
      .lte("media_delete_after", now);

    if (selectError) {
      return Response.json({ ok: false, error: selectError.message }, { status: 500 });
    }

    const rows = (verifications ?? []) as CleanupVerificationRow[];
    const paths = rows.map((item: CleanupVerificationRow) => item.media_path).filter(Boolean) as string[];

    if (paths.length > 0) {
      const { error: removeError } = await ctx.supabaseAdmin.storage
        .from("verification-private")
        .remove(paths);

      if (removeError) {
        await ctx.supabaseAdmin.from("moderation_logs").insert({
          action: "verification_media_cleanup",
          metadata: {
            success: false,
            deleted_rows: 0,
            error: removeError.message,
            attempted_paths: paths.length,
          },
        });

        return Response.json({ ok: false, error: removeError.message }, { status: 500 });
      }
    }

    for (const row of rows) {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? row.metadata
          : {};

      const { error: updateError } = await ctx.supabaseAdmin
        .from("verifications")
        .update({
          media_path: null,
          metadata: {
            ...metadata,
            media_cleaned_at: now,
          },
        })
        .eq("id", row.id);

      if (updateError) {
        return Response.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    }

    await ctx.supabaseAdmin.from("moderation_logs").insert({
      action: "verification_media_cleanup",
      metadata: {
        success: true,
        deleted_rows: rows.length,
      },
    });

    return Response.json({
      ok: true,
      deletedRows: rows.length,
    });
  }),
};
