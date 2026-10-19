const MAX_ATTEMPTS = 2;

export function validateRepairEngineInvocation({ authenticated, mode, repair, request } = {}) {
  if (authenticated !== true) return { ok: false, reason: 'unauthenticated' };
  if (mode !== 'allowlist') return { ok: false, reason: 'mode_not_allowed' };
  if (!repair || !request) return { ok: false, reason: 'missing_input' };
  if (repair.risk !== 'low') return { ok: false, reason: 'risk_not_allowed' };
  if (repair.status !== 'queued') return { ok: false, reason: 'status_not_allowed' };
  if (repair.id !== request.repairId || repair.job_id !== request.jobId) {
    return { ok: false, reason: 'identity_mismatch' };
  }

  const attempt = Number(request.attempt);
  const storedAttempt = Number(repair.attempt_count);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) {
    return { ok: false, reason: 'attempt_not_allowed' };
  }
  if (!Number.isInteger(storedAttempt) || storedAttempt !== attempt) {
    return { ok: false, reason: 'attempt_mismatch' };
  }

  return { ok: true };
}
