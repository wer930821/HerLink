"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const OLD_GUXING_ANONYMOUS_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const GUXING_ACCOUNT_ID = "671fac06-8eeb-4b95-830a-8d4e141fda9a";
const LOGIN_RECOVERY_KEY = "herlink_guxing_account_login_recovery_v1";
const ANONYMOUS_SESSION_BACKUP_COOKIE = "herlink_anon_session_backup";

function clearAnonymousSessionBackup() {
  document.cookie = `${ANONYMOUS_SESSION_BACKUP_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}

export function MigratedGuxingSessionGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session ?? null;
      const userId = session?.user.id ?? null;

      if (userId === OLD_GUXING_ANONYMOUS_ID) {
        // This UUID was migrated into the permanent account. Keeping its old
        // anonymous token makes the home page look signed in as an empty user.
        // Remove only this retired identity; never create a replacement.
        window.localStorage.setItem(LOGIN_RECOVERY_KEY, "1");
        clearAnonymousSessionBackup();
        await supabase.auth.signOut();
        if (mounted) setShowLogin(true);
        if (pathname === "/") window.location.replace("/");
        return;
      }

      if (userId === GUXING_ACCOUNT_ID) {
        window.localStorage.removeItem(LOGIN_RECOVERY_KEY);
        if (mounted) setShowLogin(false);
        return;
      }

      if (!session && window.localStorage.getItem(LOGIN_RECOVERY_KEY) === "1") {
        if (mounted) setShowLogin(true);
        return;
      }

      if (mounted) setShowLogin(false);
    })();

    return () => { mounted = false; };
  }, [pathname]);

  if (pathname !== "/" || !showLogin) return null;

  return (
    <div
      aria-label="孤星企鵝帳號登入"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "max(22px, env(safe-area-inset-bottom))",
        transform: "translateX(-50%)",
        zIndex: 80,
        width: "min(calc(100% - 36px), 520px)",
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        onClick={() => router.push("/login")}
        style={{
          width: "100%",
          minHeight: 56,
          border: "1px solid rgba(255, 150, 95, .45)",
          borderRadius: 18,
          background: "linear-gradient(135deg, #ff765f, #ff982f)",
          color: "#1b1110",
          fontSize: 18,
          fontWeight: 900,
          boxShadow: "0 16px 40px rgba(0,0,0,.32)",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        登入既有帳號
      </button>
    </div>
  );
}
