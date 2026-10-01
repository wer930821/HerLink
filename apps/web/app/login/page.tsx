"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../../lib/auth-ui";
import { signIn, supabase } from "../../lib/supabase";
import { Button, Field, Notice, PageHero, Surface } from "../../components/ui";

function getLoginDestination() {
  if (typeof window === "undefined") return "/";
  return new URLSearchParams(window.location.search).get("next") === "/admin" ? "/admin" : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [destination, setDestination] = useState("/");
  const isAdminLogin = destination === "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [adminCreateMode, setAdminCreateMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextDestination = getLoginDestination();
    setDestination(nextDestination);
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (nextDestination === "/admin" && data.session?.user.is_anonymous) {
        void supabase.auth.signOut();
        return;
      }
      if (data.session && nextDestination !== "/admin") {
        router.replace(nextDestination);
      }
    });
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isAdminLogin && adminCreateMode) {
        if (password.length < 10) {
          throw new Error("管理員密碼至少需要 10 個字元。");
        }
        if (password !== confirmPassword) {
          throw new Error("兩次輸入的密碼不一致。");
        }
        if (!inviteCode.trim()) {
          throw new Error("請輸入管理員建立碼。");
        }

        const response = await fetch("/api/admin/bootstrap/create-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
            inviteCode: inviteCode.trim(),
          }),
          cache: "no-store",
        });

        const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "目前無法建立管理員帳號。");
        }
      }

      const { error: authError } = await signIn(email.trim(), password);
      if (authError) {
        throw authError;
      }
      router.replace(getLoginDestination());
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message || getFriendlyAuthErrorMessage(err, "登入失敗，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={isAdminLogin ? "stack admin-login-page" : "stack"}>
      <PageHero
        title={isAdminLogin ? (adminCreateMode ? "建立管理員帳號" : "登入管理員帳號") : "登入 HerLink"}
        description={
          isAdminLogin
            ? adminCreateMode
              ? "輸入管理員建立碼，建立完成後會直接登入後台。"
              : "使用管理員 Email / 密碼登入後台。"
            : "登入後會先進入匿名設定，再開始隨機配對。"
        }
      />
      <Surface as="form" elevation={1} onSubmit={onSubmit}>
        <Field label="電子郵件" htmlFor="login-email">
          <input
            id="login-email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="請輸入電子郵件"
          />
        </Field>
        <Field label="密碼" htmlFor="login-password" hint={isAdminLogin && adminCreateMode ? "至少 10 個字元" : undefined}>
          <input
            id="login-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={isAdminLogin && adminCreateMode ? "new-password" : "current-password"}
          />
        </Field>
        {isAdminLogin && adminCreateMode ? (
          <>
            <Field label="確認密碼" htmlFor="login-confirm-password">
              <input
                id="login-confirm-password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </Field>
            <Field label="管理員建立碼" htmlFor="admin-invite-code" hint="建立碼只能使用一次，過期後需重新產生">
              <input
                id="admin-invite-code"
                className="input"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="HL-XXXXXXXX-..."
              />
            </Field>
          </>
        ) : null}
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? (adminCreateMode ? "建立中…" : "登入中…") : adminCreateMode ? "建立並登入" : "登入"}
        </Button>
        {!isAdminLogin ? (
          <Button variant="ghost" size="lg" type="button" onClick={() => router.push("/signup")} disabled={loading}>
            還沒有帳號？前往註冊
          </Button>
        ) : null}
        {isAdminLogin ? (
          <Button
            variant="link"
            type="button"
            onClick={() => {
              setAdminCreateMode((value) => !value);
              setError(null);
              setConfirmPassword("");
              setInviteCode("");
            }}
            disabled={loading}
          >
            {adminCreateMode ? "已有管理員帳號？回到登入" : "沒有管理員帳號？使用建立碼"}
          </Button>
        ) : null}
        {!adminCreateMode ? (
          <Button variant="link" type="button" onClick={() => router.push("/forgot-password")} disabled={loading}>
            忘記密碼？
          </Button>
        ) : null}
      </Surface>
    </main>
  );
}
