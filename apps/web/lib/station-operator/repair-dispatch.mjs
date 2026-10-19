const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALLOWED_ROOTS=['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/'];
const MAX_REPAIR_FILES=5;
const MAX_FILE_BYTES=50000;
const BLOCKED_PATHS=[
  /^\.github\//,
  /^supabase\/migrations\//,
  /(^|\/)\.env(?:\.|$)/,
  /^apps\/web\/lib\/station-operator(?:\/|$)/,
  /^apps\/web\/app\/api\/internal\/station-repair(?:\/|$)/
];

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

  return {ok:true,repairId:id,jobId,branch:`ai-repair/${jobId}`,summary,attempt};
}

export function buildRepairEngineRequest({dispatch}={}) {
  if (!dispatch?.ok) throw new Error('Invalid repair dispatch');
  const {repairId,jobId,branch,summary,attempt}=dispatch;
  if (!SAFE_ID.test(String(repairId ?? '')) || !SAFE_ID.test(String(jobId ?? ''))) throw new Error('Invalid repair dispatch');
  if (branch !== `ai-repair/${jobId}` || !Number.isInteger(attempt) || attempt < 1 || attempt > 2) throw new Error('Invalid repair dispatch');
  const safeSummary=String(summary ?? '').trim().slice(0,800);
  if (!safeSummary) throw new Error('Invalid repair dispatch');
  return {repairId,jobId,branch,summary:safeSummary,attempt,allowedRoots:[...ALLOWED_ROOTS]};
}

export function validateRepairPlan(plan={}) {
  const files=Array.isArray(plan.files) ? plan.files : [];
  if (files.length < 1 || files.length > MAX_REPAIR_FILES) return {ok:false,reason:'file_count'};
  const seen=new Set();
  const safe=[];
  for (const file of files) {
    const path=String(file?.path ?? '').replace(/\\/g,'/').replace(/^\.\//,'');
    const content=typeof file?.content === 'string' ? file.content : '';
    if (!path || seen.has(path)) return {ok:false,reason:'duplicate_or_missing_path'};
    seen.add(path);
    if (!ALLOWED_ROOTS.some(root=>path.startsWith(root)) || BLOCKED_PATHS.some(pattern=>pattern.test(path))) return {ok:false,reason:'blocked_path'};
    if (!content || Buffer.byteLength(content,'utf8') > MAX_FILE_BYTES) return {ok:false,reason:'invalid_size'};
    if (/```(?:sh|bash|shell|zsh|powershell|cmd)?\b/i.test(content) || /\brm\s+-rf\b/i.test(content)) return {ok:false,reason:'command_content'};
    safe.push({path,content});
  }
  return {ok:true,files:safe};
}

export function buildRepairPrSpec({request,plan}={}) {
  const repairId=String(request?.repairId ?? '');
  const jobId=String(request?.jobId ?? '');
  const branch=String(request?.branch ?? '');
  const attempt=Number(request?.attempt ?? 0);
  if (!SAFE_ID.test(repairId) || !SAFE_ID.test(jobId) || branch !== `ai-repair/${jobId}` || !Number.isInteger(attempt) || attempt < 1 || attempt > 2 || plan?.ok !== true || !Array.isArray(plan.files) || plan.files.length < 1) {
    throw new Error('Invalid repair PR');
  }
  const validated=validateRepairPlan({files:plan.files});
  if (!validated.ok) throw new Error('Invalid repair PR');
  return {
    branch,
    base:'main',
    draft:true,
    title:`fix: automated repair ${jobId}`,
    body:`Automated low-risk repair.\n\nRepair: ${repairId}\nAttempt: ${attempt}\n\nRequires CI validation before any merge.`,
    files:validated.files
  };
}
