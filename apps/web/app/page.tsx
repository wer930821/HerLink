"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFriendlyAuthErrorMessage } from "../lib/auth-ui";
import {
  findOrJoinRandomMatch,
  getCurrentSession,
  isAnonymousProfileReady,
  isSupabaseConfigured,
  loadMyActiveRandomSession,
  loadMyProfile,
  loadMyRandomQueue,
  signInAnonymously,
  requestRandomIdentityRecovery,
  type RandomQueueRow,
  type RandomSessionRow,
  type Session,
  type WebProfile,
} from "../lib/supabase";

type BootstrapState = {
  session: Session | null;
  profile: WebProfile | null;
  queue: RandomQueueRow | null;
  activeSession: RandomSessionRow | null;
};

const emptyBootstrapState: BootstrapState = {
  session: null,
  profile: null,
  queue: null,
  activeSession: null,
};

export default function HomePage() {
  const router = useRouter();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [state, setState] = useState<BootstrapState>(emptyBootstrapState);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryName, setRecoveryName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      setBootstrapping(true);
      try {
        const { data } = await getCurrentSession();
        const session = data.session ?? null;
        if (!session) {
          if (mounted) setState(emptyBootstrapState);
          return;
        }
        const [profileResult, queueResult, sessionResult] = await Promise.all([
          loadMyProfile(session.user.id),
          loadMyRandomQueue(session.user.id),
          loadMyActiveRandomSession(),
        ]);
        if (!mounted) return;
        setState({
          session,
          profile: profileResult.data ?? null,
          queue: queueResult.data ?? null,
          activeSession: sessionResult.data ?? null,
        });
      } catch {
        if (mounted) {
          setState(emptyBootstrapState);
          setMessage("目前無法載入狀態，請重新整理後再試。");
        }
      } finally {
        if (mounted) setBootstrapping(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (bootstrapping || !state.session) return;
    if (!state.profile || !isAnonymousProfileReady(state.profile)) router.replace("/onboarding");
  }, [bootstrapping, router, state.profile, state.session]);

  const anonymousSummary = useMemo(() => ({
    name: state.profile?.anonymous_display_name ?? "匿名使用者",
  }), [state.profile]);
  const isGuxingPenguin = anonymousSummary?.name === "孤星企鵝";

  const startAnonymous = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const { data: existingSessionData } = await getCurrentSession();
      if (existingSessionData.session) {
        window.location.assign("/onboarding");
        return;
      }
      const { data, error } = await signInAnonymously();
      if (error) throw error;
      if (!data.session) throw new Error("匿名登入未建立工作階段");
      window.location.assign("/onboarding");
    } catch (error) {
      setMessage(getFriendlyAuthErrorMessage(error, "目前無法建立匿名身份，請稍後再試。"));
      setActionBusy(false);
    }
  };

  const startRecovery = async () => {
    if (actionBusy || !recoveryName.trim()) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const sessionResult = await getCurrentSession();
      if (!sessionResult.data.session) {
        const signInResult = await signInAnonymously();
        if (signInResult.error) throw signInResult.error;
      }
      const result = await requestRandomIdentityRecovery(recoveryName);
      if (result.error) throw result.error;
      const row = result.data?.[0];
      if (!row?.recovery_code) throw new Error("無法建立恢復申請");
      setRecoveryCode(row.recovery_code);
    } catch {
      setMessage("目前找不到可恢復的聊天室，請確認原本的匿名名稱，或聯絡管理員協助。");
    } finally {
      setActionBusy(false);
    }
  };

  const startMatching = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const { data, error } = await findOrJoinRandomMatch();
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.status === "matched" && result.session_id) {
        router.push(`/session/${result.session_id}`);
        return;
      }
      router.push("/waiting");
    } catch (error) {
      setMessage(getFriendlyAuthErrorMessage(error, "目前無法開始配對，請稍後再試。"));
    } finally {
      setActionBusy(false);
    }
  };

  if (!isSupabaseConfigured()) {
    return <main className="panel"><h1 className="hero-title">HerLink</h1><p className="hero-copy">測試環境尚未設定 Supabase。</p></main>;
  }

  if (bootstrapping) {
    return <main className="hero"><h1 className="hero-title">HerLink</h1><p className="hero-copy">正在檢查匿名身份…</p></main>;
  }

  if (!state.session) {
    return (
      <main className="stack">
        <section className="hero">
          <div className="halloween-banner"><span>🎃</span><strong>HAPPY HALLOWEEN</strong><span>👻</span></div>
          <h1 className="hero-title">HerLink</h1>
          <p className="hero-copy">不公開個人檔案，不做交友滑卡，只保留匿名隨機配對與聊天室。</p>
          <div className="row">
            <button className="button" onClick={startAnonymous} disabled={actionBusy}>{actionBusy ? "處理中…" : "開始匿名聊天"}</button>
            <button className="ghost" onClick={() => setShowRecovery((value) => !value)} disabled={actionBusy}>無法進入原本聊天室？</button>
          </div>
          {showRecovery ? (
            <div className="panel">
              <p className="title">找回原本聊天室</p>
              <p className="hero-copy">輸入原本匿名名稱，取得新的 8 碼恢復碼。</p>
              <input className="input" value={recoveryName} onChange={(event) => setRecoveryName(event.target.value)} placeholder="原本的匿名名稱" disabled={actionBusy || Boolean(recoveryCode)} />
              {!recoveryCode ? <button className="button" onClick={startRecovery} disabled={actionBusy || !recoveryName.trim()}>取得恢復碼</button> : <div className="notice">恢復碼：<strong>{recoveryCode}</strong></div>}
            </div>
          ) : null}
          {message ? <div className="notice">{message}</div> : null}
        </section>
        <footer className="halloween-footer">安全說明　服務條款　隱私權政策</footer>
        <style jsx>{homeStyles}</style>
      </main>
    );
  }

  return (
    <main className="halloween-home">
      <section className="halloween-card">
        <div className="halloween-banner"><span>🎃</span><strong>HAPPY HALLOWEEN</strong><span>👻</span></div>
        <div className="home-topline">
          <div>
            <div className="brand">HerLink</div>
            <h1>匿名聊天</h1>
          </div>
          <div className="top-actions">
            <button className="crown-button" aria-label="彩蛋圖鑑與任務" title="彩蛋圖鑑與任務" onClick={() => setMessage("彩蛋圖鑑與任務入口已移到小王冠。")}>♛</button>
            <button className="mail-button" onClick={() => setMessage("信箱入口保留於首頁右上方。")}>信箱</button>
          </div>
        </div>
        <p className="subtitle">不公開個人檔案，不做交友滑卡，只保留匿名隨機配對與聊天室。</p>

        <div className="identity-card">
          <div><span>你的匿名名稱</span><strong>{anonymousSummary.name}</strong></div>
          <button onClick={() => router.push("/onboarding")}>更換</button>
        </div>

        <button className="match-button" onClick={startMatching} disabled={actionBusy}>{actionBusy ? "配對中…" : "配對新的人"}</button>
        <div className="secondary-actions">
          <button onClick={() => state.activeSession ? router.push(`/session/${state.activeSession.id}`) : setMessage("目前沒有進行中的聊天室。")}>我的聊天</button>
          <button onClick={() => setMessage("匿名聯絡人入口保留於此位置。")}>匿名聯絡人</button>
        </div>

        {isGuxingPenguin ? (
          <div className="guxing-account-actions" data-testid="guxing-account-actions">
            <button onClick={() => router.push("/signup")}>申請帳號</button>
            <button className="login" onClick={() => router.push("/login")}>登入既有帳號</button>
          </div>
        ) : null}

        <div className="presence-row">
          <span>正在出沒 <strong>{state.activeSession ? "1" : "0"}</strong> 人</span>
          <span>等人來聊 <strong>{state.queue?.status === "waiting" ? "1" : "0"}</strong> 人</span>
        </div>
        {message ? <div className="home-message">{message}</div> : null}
      </section>
      <footer className="halloween-footer">安全說明　服務條款　隱私權政策</footer>
      <style jsx>{homeStyles}</style>
    </main>
  );
}

const homeStyles = `
  .halloween-home { min-height: calc(100dvh - 48px); display: grid; align-content: start; gap: 14px; }
  .halloween-card { position: relative; overflow: hidden; padding: 22px; border: 1px solid rgba(255,151,74,.25); border-radius: 28px; background: radial-gradient(circle at 90% 8%, rgba(255,111,0,.16), transparent 28%), linear-gradient(160deg,#171221 0%,#100c18 100%); box-shadow: 0 20px 70px rgba(0,0,0,.35); }
  .halloween-card:before { content: "✦  ☾  ✧  🦇"; position: absolute; right: 18px; top: 72px; color: rgba(255,169,77,.22); font-size: 22px; letter-spacing: 8px; pointer-events: none; }
  .halloween-banner { display: flex; justify-content: center; align-items: center; gap: 9px; margin-bottom: 18px; color: #ff9c47; font-size: 12px; letter-spacing: .18em; }
  .home-topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .brand { color: #ff9c47; font-weight: 900; letter-spacing: .04em; }
  h1 { margin: 5px 0 0; font-size: clamp(2rem,8vw,3.1rem); letter-spacing: -.04em; }
  .subtitle { max-width: 520px; margin: 12px 0 20px; color: #bdb4cc; line-height: 1.65; }
  .top-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .top-actions button, .identity-card button, .secondary-actions button, .guxing-account-actions button { min-height: 40px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; background: rgba(255,255,255,.055); color: #f8f3ff; padding: 8px 14px; cursor: pointer; }
  .crown-button { width: 40px; padding: 0 !important; color: #ffc46b !important; font-size: 20px; }
  .identity-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 20px; background: rgba(255,255,255,.045); }
  .identity-card div { display: grid; gap: 4px; }
  .identity-card span { color: #9f96af; font-size: 12px; }
  .identity-card strong { font-size: 18px; }
  .match-button { width: 100%; min-height: 54px; margin-top: 14px; border: 0; border-radius: 18px; background: linear-gradient(135deg,#ff7a2f,#ff9b45); color: #241108; font-weight: 900; font-size: 17px; cursor: pointer; }
  .match-button:disabled { opacity: .65; }
  .secondary-actions, .guxing-account-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .secondary-actions button { border-radius: 16px; min-height: 48px; font-weight: 700; }
  .guxing-account-actions { margin-top: 10px; }
  .guxing-account-actions button { min-height: 44px; font-weight: 800; background: rgba(255,255,255,.08); }
  .guxing-account-actions .login { border-color: rgba(255,132,48,.45); background: rgba(255,122,47,.16); color: #ffb270; }
  .presence-row { display: flex; justify-content: center; flex-wrap: wrap; gap: 9px; margin-top: 15px; }
  .presence-row span { padding: 7px 11px; border-radius: 999px; background: rgba(255,255,255,.045); color: #aaa1ba; font-size: 12px; }
  .presence-row strong { color: #ffad64; }
  .home-message { margin-top: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,.04); color: #bdb4cc; font-size: 13px; text-align: center; }
  .halloween-footer { padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); color: #756d83; font-size: 12px; text-align: center; line-height: 1.6; }
  @media (max-width: 520px) { .halloween-home { min-height: calc(100dvh - 32px); } .halloween-card { padding: 18px 16px; border-radius: 24px; } .home-topline { align-items: center; } .top-actions button { min-height: 36px; } .mail-button { padding-inline: 12px !important; } .crown-button { width: 36px; } .secondary-actions, .guxing-account-actions { gap: 8px; } }
`;
