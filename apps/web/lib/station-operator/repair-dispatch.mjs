const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALLOWED_ROOTS=['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/'];

export function buildRepairDispatch({repair,attemptCount}={}) {
  const id=String(repair?.id ?? '');
  const jobId=String(repair?.job_id ?? '');
  const status=String(repair?.status ?? '');
  const risk=String(repair?.risk ?? '');
  const attempt=Number(attemptCount ?? repair?.attempt_count ?? 0);
  const summary=String(repair?.summary ?? '').trim().slice(0,800);

  if (!SAFE_ID.test(id) || !SAFE_ID.test(jobId)) return {ok:false,reason:'invalid_id'};
  if (status !== 'queued') return {ok:false,reason:'invalid_status'};
  if (risk !== 'low') return {ok:false,reason:'risk_not_low'};
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) return {ok:false,reason:'attempt_limit'};
  if (!summary) return {ok:false,reason:'missing_summary'};

  return {
    ok:true,
    repairId:id,
    jobId,
    branch:`ai-repair/${jobId}`,
    summary,
    attempt
  };
}

export function buildRepairEngineRequest({dispatch}={}) {
  if (!dispatch?.ok) throw new Error('Invalid repair dispatch');
  const {repairId,jobId,branch,summary,attempt}=dispatch;
  if (!SAFE_ID.test(String(repairId ?? '')) || !SAFE_ID.test(String(jobId ?? ''))) {
    throw new Error('Invalid repair dispatch');
  }
  if (branch !== `ai-repair/${jobId}` || !Number.isInteger(attempt) || attempt < 1 || attempt > 2) {
    throw new Error('Invalid repair dispatch');
  }
  const safeSummary=String(summary ?? '').trim().slice(0,800);
  if (!safeSummary) throw new Error('Invalid repair dispatch');

  return {
    repairId,
    jobId,
    branch,
    summary:safeSummary,
    attempt,
    allowedRoots:[...ALLOWED_ROOTS]
  };
}
