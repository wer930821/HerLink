"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";
import { claimPermanentRecovery, normalizePermanentRecoveryCode, previewPermanentRecovery } from "../lib/permanent-recovery";

type Props = { onBack: () => void; onRecovered?: () => void };

export function PermanentRecoveryFlow({ onBack, onRecovered }: Props) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = async () => {
    setBusy(true); setError(null);
    try { const result = await previewPermanentRecovery(code); setDisplayName(result.displayName); }
    catch (e) { setError(e instanceof Error ? e.message : "找不到這組恢復碼。"); }
    finally { setBusy(false); }
  };

  const claim = async () => {
    setBusy(true); setError(null);
    try {
      const result = await claimPermanentRecovery(code);
      setDisplayName(result.displayName);
      setNewRecoveryCode(result.newRecoveryCode);
      onRecovered?.();
    } catch (e) { setError(e instanceof Error ? e.message : "目前無法接回匿名身分。"); }
    finally { setBusy(false); }
  };

  if (newRecoveryCode) return (
    <div className="stack">
      <Notice variant="success" title="已接回原本匿名身分">
        <div>新的永久恢復碼</div>
        <strong style={{ fontSize: 22, letterSpacing: 2 }}>{newRecoveryCode}</strong>
        <div className="small" style={{ marginTop: 8 }}>請保存這組新碼；舊恢復碼已失效。</div>
      </Notice>
      <Button onClick={() => window.location.assign("/")}>回到首頁</Button>
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
