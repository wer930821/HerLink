import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

const rootEnv = loadEnvFile(path.resolve("../../.supabase.test.env"));
const fallbackEnv = loadEnvFile(path.resolve("../../.env"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || rootEnv.EXPO_PUBLIC_SUPABASE_URL || fallbackEnv.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || rootEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || fallbackEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY || rootEnv.EXPO_PUBLIC_VAPID_PUBLIC_KEY || fallbackEnv.EXPO_PUBLIC_VAPID_PUBLIC_KEY || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { externalDir: true },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublicKey,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
