declare module "npm:@supabase/server" {
  export function withSupabase(
    config: { auth: string },
    handler: (req: Request, ctx: { supabaseAdmin: any }) => Promise<Response> | Response
  ): {
    fetch: (req: Request) => Promise<Response> | Response;
  };
}
