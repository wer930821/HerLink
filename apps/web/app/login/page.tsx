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
  const [adminCreateMode, setAdminCreateMode] = useState(false);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextDestination = getLoginDestination();
    setDestination(nextDestination);
    if (nextDestination === "/admin") {
      void supabase.rpc("admin_bootstrap_available").then(({ data }) => {
        setBootstrapAvailable(data === true);
      }).catch(() => setBootstrapAvailable(false));
    }

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
    setSuccess(null);
    try {
      if (isAdminLogin && adminCreateMode) {
        if (password.length < 10) {
          throw new Error("管理員密碼至少需要 10 個字元。");
        }
        if (password !== confirmPassword) {
          throw new Error("兩次輸入的密碼不一致。");
        }

        const redirectTo = `${window.location.origin}/auth/callback?next=/admin`;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session) {
          router.replace("/admin");
        } else {
          setSuccess("確認信已寄出，請到 Email 點擊確認連結。確認後會自動取得後台管理員權限。");
        }
        return;
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
              ? "首次啟用僅限已設定的管理員 Email。完成 Email 驗證後會自動取得後台權限。"
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

          </>
        ) : null}
        {error ? <Notice variant="danger">{error}</Notice> : null}
        {success ? <Notice variant="success">{success}</Notice> : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? (adminCreateMode ? "建立中…" : "登入中…") : adminCreateMode ? "建立並登入" : "登入"}
        </Button>
        {!isAdminLogin ? (
          <Button variant="ghost" size="lg" type="button" onClick={() => router.push("/signup")} disabled={loading}>
            還沒有帳號？前往註冊
          </Button>
        ) : null}
        {isAdminLogin && (bootstrapAvailable || adminCreateMode) ? (
          <Button
            variant="link"
            type="button"
            onClick={() => {
              setAdminCreateMode((value) => !value);
              setError(null);
              setConfirmPassword("");
              setSuccess(null);
            }}
            disabled={loading}
          >
            {adminCreateMode ? "已有管理員帳號？回到登入" : "第一次使用？啟用管理員帳號"}
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
