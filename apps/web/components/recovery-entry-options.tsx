import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import {
  RECOVERY_ADMIN_PATH_LABEL,
  RECOVERY_CODE_PATH_LABEL,
  RECOVERY_DIALOG_INTRO,
} from "../lib/recovery-copy";

type RecoveryEntryOptionsProps = {
  onUseAdminRecovery: () => void;
};

export function RecoveryEntryOptions({ onUseAdminRecovery }: RecoveryEntryOptionsProps) {
  return (
    <div className="stack">
      <p className="muted">{RECOVERY_DIALOG_INTRO}</p>
      <Notice variant="info" title={RECOVERY_CODE_PATH_LABEL}>
        永久自助恢復功能正在完成中，目前先不要輸入舊恢復碼；避免半成品造成身分誤接。
      </Notice>
      <Button variant="secondary" onClick={onUseAdminRecovery}>
        {RECOVERY_ADMIN_PATH_LABEL}
      </Button>
    </div>
  );
}
