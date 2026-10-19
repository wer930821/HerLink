const MAX_ATTEMPTS = 2;
const SECRET_ASSIGNMENT = /\b(token|secret|password|api[_-]?key|service[_-]?role|bearer)\s*=\s*[^\s]+/gi;

function sanitizeCiSummary(value) {
  return String(value ?? '')
    .replace(SECRET_ASSIGNMENT, '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .slice(0, 1200);
}

export function nextRepairState({ status, attempt, event, ciSummary } = {}) {
  const n = Number(attempt);
  if (status !== 'waiting_ci') return { ok: false, reason: 'invalid_status' };
  if (!Number.isInteger(n) || n < 1 || n > MAX_ATTEMPTS) return { ok: false, reason: 'invalid_attempt' };

  if (event === 'ci_success') {
    return { ok: true, status: 'waiting_merge', attempt: n };
  }

  if (event !== 'ci_failure') return { ok: false, reason: 'invalid_event' };

  if (n === 1) {
    return {
      ok: true,
      status: 'queued',
      attempt: 2,
      ciSummary: sanitizeCiSummary(ciSummary),
    };
  }

  return { ok: true, status: 'human_review', attempt: 2, reason: 'max_attempts' };
}
