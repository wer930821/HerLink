import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

function mask(value) {
  if (!value) return "(missing)";
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

function projectRefFromUrl(url) {
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (!match) throw new Error("Could not parse Supabase project ref from EXPO_PUBLIC_SUPABASE_URL");
  return match[1];
}

function makeClient(url, key, authHeader) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: authHeader
      ? {
          headers: {
            Authorization: `Bearer ${authHeader}`,
          },
        }
      : undefined,
  });
}

async function signIn(url, anonKey, email, password) {
  const client = makeClient(url, anonKey);
  const result = await client.auth.signInWithPassword({ email, password });
  return { client, result };
}

async function maybeDeleteUser(admin, userId) {
  if (!userId) return;
  await admin.auth.admin.deleteUser(userId, false);
}

async function main() {
  const envPath = path.resolve(".env");
  const env = loadEnv(envPath);
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  assertEnv("EXPO_PUBLIC_SUPABASE_URL", url);
  assertEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  assertEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);

  const ref = projectRefFromUrl(url);
  const admin = makeClient(url, serviceRoleKey, serviceRoleKey);
  const summary = {
    env: {
      url: mask(url),
      anonKey: mask(anonKey),
      serviceRoleKey: mask(serviceRoleKey),
      ref,
    },
    migrationAttempt: null,
    migrationState: null,
    tests: {},
    cleanup: {},
  };

  const createdUserIds = [];

  try {
    const listUsersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    summary.tests.serviceRoleKeyUsable = {
      ok: !listUsersResult.error,
      error: listUsersResult.error?.message ?? null,
    };

    summary.tests.urlReachable = {
      ok: true,
      host: new URL(url).host,
    };

    const managementResponse = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        query: fs.readFileSync(path.resolve("docs", "migration.sql"), "utf8"),
      }),
    });

    let managementBody = "";
    try {
      managementBody = JSON.stringify(await managementResponse.json());
    } catch {
      managementBody = await managementResponse.text();
    }

    summary.migrationAttempt = {
      ok: managementResponse.ok,
      status: managementResponse.status,
      statusText: managementResponse.statusText,
      bodyPreview: managementBody.slice(0, 240),
    };

    const baseEmail = `herlink.phase1.${Date.now()}`;
    const password = `HerLink!${Date.now()}Aa`;

    const users = {
      a: { email: `${baseEmail}.a@example.com`, password },
      b: { email: `${baseEmail}.b@example.com`, password },
      c: { email: `${baseEmail}.c@example.com`, password },
    };

    for (const key of ["a", "b", "c"]) {
      const user = users[key];
      const created = await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      });
      summary.tests[`createUser${key.toUpperCase()}`] = {
        ok: !created.error,
        error: created.error?.message ?? null,
      };
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      createdUserIds.push(user.id);
    }

    const signInA = await signIn(url, anonKey, users.a.email, users.a.password);
    const signInB = await signIn(url, anonKey, users.b.email, users.b.password);
    const signInC = await signIn(url, anonKey, users.c.email, users.c.password);

    summary.tests.anonKeyUsable = {
      ok: !signInA.result.error && !signInB.result.error && !signInC.result.error,
      error: signInA.result.error?.message ?? signInB.result.error?.message ?? signInC.result.error?.message ?? null,
    };

    if (signInA.result.error) throw signInA.result.error;
    if (signInB.result.error) throw signInB.result.error;
    if (signInC.result.error) throw signInC.result.error;

    const clientA = signInA.client;
    const clientB = signInB.client;
    const clientC = signInC.client;

    const onboardingA = await clientA.from("profiles").upsert({
      id: users.a.id,
      display_name: "Tester A",
      birthday: "1995-01-01",
      city: "Taipei",
      bio: "Phase 1 Test A",
      orientation: "Lesbian",
      identity_label: "Woman",
      relationship_goals: ["長期關係"],
      interests: ["閱讀"],
      onboarding_completed: true,
      created_at: new Date().toISOString(),
    });

    const onboardingB = await clientB.from("profiles").upsert({
      id: users.b.id,
      display_name: "Tester B",
      birthday: "1994-02-02",
      city: "Kaohsiung",
      bio: "Phase 1 Test B",
      orientation: "Bisexual",
      identity_label: "Woman",
      relationship_goals: ["交朋友"],
      interests: ["電影"],
      onboarding_completed: true,
      created_at: new Date().toISOString(),
    });

    const onboardingC = await clientC.from("profiles").upsert({
      id: users.c.id,
      display_name: "Tester C",
      birthday: "1993-03-03",
      city: "Taichung",
      bio: "Phase 1 Test C",
      orientation: "Lesbian",
      identity_label: "Woman",
      relationship_goals: ["不確定"],
      interests: ["旅行"],
      onboarding_completed: false,
      created_at: new Date().toISOString(),
    });

    summary.tests.onboardingA = { ok: !onboardingA.error, error: onboardingA.error?.message ?? null };
    summary.tests.onboardingB = { ok: !onboardingB.error, error: onboardingB.error?.message ?? null };
    summary.tests.onboardingC = { ok: !onboardingC.error, error: onboardingC.error?.message ?? null };

    const serviceSelectProfiles = await admin.from("profiles").select("id,display_name,verified,account_status,trust_score,onboarding_completed").in("id", [users.a.id, users.b.id, users.c.id]);
    summary.migrationState = {
      profilesTableUsable: !serviceSelectProfiles.error,
      profilesError: serviceSelectProfiles.error?.message ?? null,
      rowCount: serviceSelectProfiles.data?.length ?? 0,
    };

    const ownSelectA = await clientA.from("profiles").select("id,display_name,verified,account_status,trust_score,onboarding_completed").eq("id", users.a.id);
    const otherSelectA = await clientA.from("profiles").select("id,display_name").eq("id", users.b.id);

    summary.tests.profileRlsOwnRead = {
      ok: !ownSelectA.error && (ownSelectA.data?.length ?? 0) === 1,
      error: ownSelectA.error?.message ?? null,
      count: ownSelectA.data?.length ?? 0,
    };
    summary.tests.profileRlsOtherReadBlocked = {
      ok: !otherSelectA.error && (otherSelectA.data?.length ?? 0) === 0,
      error: otherSelectA.error?.message ?? null,
      count: otherSelectA.data?.length ?? 0,
    };

    const viewAInitial = await clientA.from("public_profiles").select("*").order("display_name");
    const visibleIdsInitial = (viewAInitial.data ?? []).map((row) => row.id);
    const viewKeys = Object.keys((viewAInitial.data ?? [])[0] ?? {}).sort();

    summary.tests.publicProfilesInitial = {
      ok: !viewAInitial.error,
      error: viewAInitial.error?.message ?? null,
      visibleIds: visibleIdsInitial,
      columns: viewKeys,
    };

    const expectedViewColumns = [
      "age",
      "bio",
      "city",
      "display_name",
      "id",
      "identity_label",
      "interests",
      "orientation",
      "relationship_goals",
      "verified",
    ];

    summary.tests.publicProfilesColumnsMatch = {
      ok: JSON.stringify(viewKeys) === JSON.stringify(expectedViewColumns),
      actual: viewKeys,
      expected: expectedViewColumns,
    };

    summary.tests.publicProfilesOnboardingFilter = {
      ok: visibleIdsInitial.includes(users.b.id) && !visibleIdsInitial.includes(users.c.id) && !visibleIdsInitial.includes(users.a.id),
      visibleIds: visibleIdsInitial,
    };

    const authUpdateSensitive = await clientA
      .from("profiles")
      .update({ verified: true, trust_score: 99, account_status: "suspended" })
      .eq("id", users.a.id);

    summary.tests.authCannotUpdateSensitiveFields = {
      ok: !!authUpdateSensitive.error,
      error: authUpdateSensitive.error?.message ?? null,
    };

    const serviceSensitiveUpdate = await admin
      .from("profiles")
      .update({ verified: true, trust_score: 77, account_status: "suspended" })
      .eq("id", users.b.id)
      .select("id,verified,trust_score,account_status")
      .single();

    summary.tests.serviceRoleCanUpdateSensitiveFields = {
      ok:
        !serviceSensitiveUpdate.error &&
        serviceSensitiveUpdate.data?.verified === true &&
        serviceSensitiveUpdate.data?.trust_score === 77 &&
        serviceSensitiveUpdate.data?.account_status === "suspended",
      error: serviceSensitiveUpdate.error?.message ?? null,
      row: serviceSensitiveUpdate.data ?? null,
    };

    const viewAfterSuspend = await clientA.from("public_profiles").select("*").order("display_name");
    const visibleIdsAfterSuspend = (viewAfterSuspend.data ?? []).map((row) => row.id);

    summary.tests.publicProfilesSuspendedFilter = {
      ok: !visibleIdsAfterSuspend.includes(users.b.id) && !visibleIdsAfterSuspend.includes(users.c.id),
      visibleIds: visibleIdsAfterSuspend,
      error: viewAfterSuspend.error?.message ?? null,
    };

    const serviceReadAll = await admin.from("profiles").select("id,verified,account_status,trust_score,onboarding_completed").in("id", [users.a.id, users.b.id, users.c.id]).order("id");
    summary.tests.serviceRoleProfileRead = {
      ok: !serviceReadAll.error && (serviceReadAll.data?.length ?? 0) === 3,
      error: serviceReadAll.error?.message ?? null,
      rows: serviceReadAll.data ?? null,
    };
  } finally {
    for (const userId of createdUserIds) {
      try {
        await maybeDeleteUser(admin, userId);
      } catch (error) {
        summary.cleanup[userId] = error instanceof Error ? error.message : String(error);
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    fatal: true,
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
