"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";
import { claimPermanentRecovery, normalizePermanentRecoveryCode, previewPermanentRecovery } from "../lib/permanent-recovery";
import { ensureAnonymousBootstrapProfile, loadMyActiveRandomSession, signInAnonymously } from "../lib/supabase";

type Props = { onBack: () => void; onRecovered?: () => void };

export function PermanentRecoveryFlow({ onBack, onRecovered }: Props) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepareReplacementPrincipal = async () => {
    const { data, error: authError } = await signInAnonymously();
    if (authError) throw new Error(authError.message || "目前無法建立匿名工作階段。");
    const authUser = data.user ?? data.session?.user;
    const userId = authUser?.id;
    if (!userId) throw new Error("目前無法建立匿名工作階段。");
    if (authUser?.is_anonymous !== true) {
      throw new Error("目前登入的是一般帳號，請使用匿名工作階段進行聊天室恢復。");
    }
    const profile = await ensureAnonymousBootstrapProfile(userId);
    if (profile.error || !profile.data?.anonymous_mode_enabled) {
      throw new Error(profile.error?.message || "目前無法準備匿名恢復身分。");
    }
    return userId;
  };

  const preview = async () => {
    setBusy(true); setError(null);
    try {
      await prepareReplacementPrincipal();
      const result = await previewPermanentRecovery(code);
      setDisplayName(result.displayName);
    } catch (e) { setError(e instanceof Error ? e.message : "找不到這組恢復碼。"); }
    finally { setBusy(false); }
  };

  const claim = async () => {
    setBusy(true); setError(null);
    try {
      const replacementUserId = await prepareReplacementPrincipal();
      const result = await claimPermanentRecovery(code);
      if (!result.identityId) throw new Error("恢復成功，但伺服器沒有回傳原匿名身分，請重新整理後再試。");

      // The auth user stays the replacement principal after a successful claim.
      // Re-read the effective profile and session through the stable-identity RPCs
      // before allowing navigation, otherwise the UI can keep showing the temporary
      // replacement identity even though the recovery transaction already succeeded.
      const effectiveProfile = await ensureAnonymousBootstrapProfile(replacementUserId);
      if (effectiveProfile.error || effectiveProfile.data?.id !== result.identityId) {
        throw new Error(effectiveProfile.error?.message || "已接回原匿名身分，但前端尚未同步完成，請重新整理後再試。");
      }

      const activeSession = await loadMyActiveRandomSession();
      if (activeSession.error) {
        throw new Error(activeSession.error.message || "已接回原匿名身分，但聊天室同步失敗，請重新整理後再試。");
      }

      setDisplayName(result.displayName);
      setRecoveredSessionId(activeSession.data?.id ?? null);
      setNewRecoveryCode(result.newRecoveryCode);
    } catch (e) { setError(e instanceof Error ? e.message : "目前無法接回匿名身分。"); }
    finally { setBusy(false); }
  };

  const copyRecoveryCode = async () => {
    if (!newRecoveryCode) return;
    try {
      await navigator.clipboard.writeText(newRecoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("複製失敗，請長按恢復碼手動複製。");
    }
  };

  const finishRecovery = () => {
    onRecovered?.();
    window.location.assign(recoveredSessionId ? `/session/${recoveredSessionId}` : "/chats");
  };

  if (newRecoveryCode) return (
    <div className="stack">
      <Notice variant="success" title="已接回原本匿名身分">
        <div>新的永久恢復碼</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 22, letterSpacing: 2 }}>{newRecoveryCode}</strong>
          <button
            type="button"
            onClick={() => void copyRecoveryCode()}
            aria-label="複製新的永久恢復碼"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 38,
              padding: "8px 14px",
              border: "1px solid currentColor",
              borderRadius: 999,
              background: "transparent",
              color: "inherit",
              fontSize: 15,
              fontWeight: 800,
              lineHeight: 1,
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            {copied ? "已複製" : "複製"}
          </button>
        </div>
        <div className="small" style={{ marginTop: 8 }}>請保存這組新碼；舊恢復碼已失效。</div>
      </Notice>
      {error ? <Notice variant="danger">{error}</Notice> : null}
      <Button onClick={finishRecovery}>{recoveredSessionId ? "我已保存，回到聊天室" : "我已保存，查看聊天室"}</Button>
    </div>
  );

  return (
    <div className="stack">
      <Notice variant="warning">接回成功後，舊裝置會立即失效，並自動產生新的永久恢復碼。</Notice>
      <Field label="8 碼恢復碼" htmlFor="permanent-recovery-code">
        <input id="permanent-recovery-code" value={code} onChange={(e) => { setCode(normalizePermanentRecoveryCode(e.target.value)); setDisplayName(null); setError(null); }} maxLength={8} autoCapitalize="characters" autoComplete="off" disabled={busy} />
      </Field>
      {error ? <Notice variant="danger">{error}</Notice> : null}
      {displayName ? (
        <Notice variant="info" title="找到匿名身分">
          <strong>{displayName}</strong>
          <div className="small" style={{ marginTop: 8 }}>確認這是你原本的匿名名稱後再接回。</div>
        </Notice>
      ) : null}
      <div className="row">
        <Button variant="secondary" onClick={onBack} disabled={busy}>返回</Button>
        {displayName ? <Button onClick={() => void claim()} disabled={busy}>{busy ? "接回中…" : "確認接回"}</Button> : <Button onClick={() => void preview()} disabled={busy || code.length !== 8}>{busy ? "確認中…" : "確認恢復碼"}</Button>}
      </div>
    </div>
  );
}
