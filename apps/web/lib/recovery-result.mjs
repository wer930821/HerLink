export function normalizeRecoveryResult(row) {
  if (!row?.recovery_code) {
    throw new Error("無法建立恢復申請");
  }

  if (!row?.id) {
    throw new Error("恢復申請尚未確認寫入成功，請再試一次");
  }

  const recoveryCode = String(row.recovery_code).trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(recoveryCode)) {
    throw new Error("恢復碼格式異常，請再試一次");
  }

  return {
    id: String(row.id),
    recovery_code: recoveryCode,
    expires_at: String(row.expires_at ?? ""),
  };
}
