import { isAuthorizedOperatorRequest } from './auth.mjs';

const ALLOWED_ROOTS=['apps/web/app/','apps/web/components/','apps/web/lib/','apps/web/__tests__/'];
const SAFE_SHA=/^[A-Fa-f0-9]{40}$/;

export async function handleRepairEngineHttp({authorization,secret,mode,payload,db,execute,resolveBaseSha}={}) {
  if (!isAuthorizedOperatorRequest(authorization,secret)) return {status:401,body:{ok:false}};
  if (!payload || typeof payload.repairId !== 'string' || !payload.repairId.trim()) return {status:400,body:{ok:false}};
  if (!db || typeof db.repair !== 'function' || typeof execute !== 'function' || typeof resolveBaseSha !== 'function') return {status:500,body:{ok:false}};
  try {
    const repair=await db.repair(payload.repairId);
    if (!repair) return {status:404,body:{ok:false}};
    const baseSha=String(await resolveBaseSha() ?? '');
    if (!SAFE_SHA.test(baseSha)) return {status:500,body:{ok:false}};
    const storedAttempt=Number(repair.attempt_count);
    const attempt=storedAttempt === 0 ? 1 : storedAttempt;
    const request={
      repairId:repair.id,
      jobId:repair.job_id,
      branch:`ai-repair/${repair.job_id}`,
      baseSha,
      summary:String(repair.summary ?? ''),
      attempt,
      allowedRoots:[...ALLOWED_ROOTS],
    };
    const result=await execute({authenticated:true,mode,repair,request});
    return {status:result?.ok ? 200 : 409,body:result ?? {ok:false}};
  } catch {
    return {status:500,body:{ok:false}};
  }
}
