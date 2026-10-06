import { Button } from "./ui/Button";
import {
  RECOVERY_ADMIN_PATH_LABEL,
  RECOVERY_DIALOG_INTRO,
} from "../lib/recovery-copy";

type RecoveryEntryOptionsProps = {
  onUseRecoveryCode: () => void;
  onUseAdminRecovery: () => void;
};

export function RecoveryEntryOptions({ onUseRecoveryCode, onUseAdminRecovery }: RecoveryEntryOptionsProps) {
  return (
    <div className="stack">
      <p className="muted">{RECOVERY_DIALOG_INTRO}</p>
      <Button onClick={onUseRecoveryCode}>我有恢復碼</Button>
      <Button variant="secondary" onClick={onUseAdminRecovery}>
        {RECOVERY_ADMIN_PATH_LABEL}
      </Button>
    </div>
  );
}
