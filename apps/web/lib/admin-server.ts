import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type AdminContext = {
  client: SupabaseClient;
  user: User;
  role: string;
};

type AdminContextError = {
  ok: false;
  status: number;
  message: string;
};

type AdminContextResult = { ok: true; context: AdminContext } | AdminContextError;

type AdminMembership = {
  user_id: string;
  role: string;
  active: boolean;
} | null;

type AdminRequestState =
  | { ok: true; client: SupabaseClient; user: User; adminRow: AdminMembership }
  | AdminContextError;

function getSupabaseServerConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  return {
    supabaseUrl,
    supabaseAnonKey,
  };
}

function createAuthedClient(accessToken: string) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseServerConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase 尚未設定。");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function getAdminRequestState(request: Request): Promise<AdminRequestState> {
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      message: "請先登入後再使用後台。",
    };
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message: "請先登入後再使用後台。",
    };
  }

  try {
    const client = createAuthedClient(accessToken);
    const { data: userData, error: userError } = await client.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return {
        ok: false,
        status: 401,
        message: "登入狀態已失效，請重新登入。",
      };
    }

    const { data: adminRow, error: adminError } = await client
      .from("admin_users")
      .select("user_id, role, active")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError) {
      return {
        ok: false,
        status: 500,
        message: "無法驗證後台權限。",
      };
    }

    return {
      ok: true,
      client,
      user: userData.user,
      adminRow,
    };
  } catch {
    return {
      ok: false,
      status: 500,
      message: "後台目前無法使用。",
    };
  }
}

export async function requireAdminRequest(request: Request): Promise<AdminContextResult> {
  const state = await getAdminRequestState(request);
  if (!state.ok) return state;

  if (!state.adminRow || !state.adminRow.active || state.adminRow.role !== "admin") {
    return {
      ok: false,
      status: 403,
      message: "你沒有後台權限。",
    };
  }

  return {
    ok: true,
    context: {
      client: state.client,
      user: state.user,
      role: state.adminRow.role,
    },
  };
}

export async function getAdminRequestDebug(request: Request) {
  const state = await getAdminRequestState(request);
  if (!state.ok) return state;

  return {
    ok: true as const,
    debug: {
      user_id: state.user.id,
      email: state.user.email ?? null,
      admin_row_exists: Boolean(state.adminRow),
      role: state.adminRow?.role ?? null,
      active: state.adminRow?.active ?? false,
      authorized: state.adminRow?.role === "admin" && state.adminRow.active === true,
    },
  };
}
