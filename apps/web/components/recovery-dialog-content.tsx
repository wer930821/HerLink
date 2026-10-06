import { Button, Field, Notice } from "./ui";
import { RecoveryEntryOptions } from "./recovery-entry-options";

type RecoveryDialogContentProps = {
  adminOpen: boolean;
  onOpenAdmin: () => void;
  recoveryName: string;
  onRecoveryNameChange: (value: string) => void;
  recoveryBusy: boolean;
  recoveryCode: string | null;
  onRequestRecovery: () => void;
};

export function RecoveryDialogContent({
  adminOpen,
  onOpenAdmin,
  recoveryName,
  onRecoveryNameChange,
  recoveryBusy,
  recoveryCode,
  onRequestRecovery,
}: RecoveryDialogContentProps) {
  return (
    <div className="stack">
      <RecoveryEntryOptions onUseAdminRecovery={onOpenAdmin} />
      {adminOpen ? (
        <>
          <p className="muted">記得原本匿名名稱的話，可建立 8 碼恢復申請，再交給站長協助接回。</p>
          <Field label="原本的匿名名稱" htmlFor="recovery-name">
            <input
              id="recovery-name"
              value={recoveryName}
              onChange={(event) => onRecoveryNameChange(event.target.value)}
              disabled={recoveryBusy || Boolean(recoveryCode)}
              autoComplete="off"
            />
          </Field>
          {recoveryCode ? (
            <Notice variant="success" title="恢復碼已建立">
              <strong style={{ fontSize: 22, letterSpacing: 2 }}>{recoveryCode}</strong>
              <div className="small" style={{ marginTop: 8 }}>請把這組 8 碼傳給管理員。</div>
            </Notice>
          ) : (
            <Button onClick={onRequestRecovery} disabled={recoveryBusy || !recoveryName.trim()}>
              {recoveryBusy ? "建立中…" : "取得恢復碼"}
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
