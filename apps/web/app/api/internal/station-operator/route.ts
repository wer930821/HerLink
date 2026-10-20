import { NextResponse } from 'next/server';
import { createOperatorDb } from '../../../../lib/station-operator/db';
import { isAuthorizedOperatorRequest } from '../../../../lib/station-operator/auth.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request:Request) {
  if (!isAuthorizedOperatorRequest(request.headers.get('authorization'), process.env.STATION_OPERATOR_SECRET)) {
    return NextResponse.json({ok:false,error:'unauthorized'},{status:401});
  }

  const [{operatorMode},{runClaimedJobs},{decideMailboxThread}] = await Promise.all([
    import('../../../../lib/station-operator/mode.mjs'),
    import('../../../../lib/station-operator/runner.mjs'),
    import('../../../../lib/station-operator/openai.mjs')
  ]);
  const mode=operatorMode(process.env);
  if (mode === 'disabled') return NextResponse.json({ok:true,mode,disabled:true,processed:0});

  const db = createOperatorDb();
  let requestedRepairId:string|null=null;
  try {
    const body=await request.clone().json();
    requestedRepairId=typeof body?.repairId === 'string' ? body.repairId : null;
  } catch {}
  if (requestedRepairId) {
    // Explicit repair dispatch is safe in both controlled allowlist and production modes.
    // The repair engine still enforces its own callback authentication and safety gates.
    if (mode !== 'allowlist' && mode !== 'production') return NextResponse.json({ok:false,mode,error:'mode_not_allowed'},{status:409});
    const repair=await db.dispatchQueuedRepair(requestedRepairId);
    if (!repair) return NextResponse.json({ok:false,error:'repair_not_dispatchable'},{status:409});
    const repairSecret=process.env.STATION_REPAIR_CALLBACK_SECRET;
    if (!repairSecret) return NextResponse.json({ok:false,error:'repair_capability_missing'},{status:500});
    const url=new URL('/api/internal/station-repair/engine',request.url);
    const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${repairSecret}`,'Content-Type':'application/json'},body:JSON.stringify({repairId:requestedRepairId}),cache:'no-store'});
    let body:Record<string,unknown>={ok:false};
    try { body=await response.json(); } catch {}
    return NextResponse.json({ok:response.ok,mode,repairId:requestedRepairId,engine:body},{status:response.ok?200:409});
  }
  const enqueued = await db.enqueue(20);
  const jobs = await db.claim(5);
  const testThreads=new Set(String(process.env.STATION_OPERATOR_TEST_THREADS ?? '').split(',').map(v=>v.trim()).filter(Boolean));
  const repairSecret=process.env.STATION_REPAIR_CALLBACK_SECRET;
  const repairEngine=(mode === 'allowlist' || mode === 'production') && repairSecret
    ? async ({repairId}:{repairId:string}) => {
        const url=new URL('/api/internal/station-repair/engine',request.url);
        const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${repairSecret}`,'Content-Type':'application/json'},body:JSON.stringify({repairId}),cache:'no-store'});
        let body:Record<string,unknown>={ok:false};
        try { body=await response.json(); } catch {}
        return response.ok ? body : {...body,ok:false};
      }
    : undefined;
  const results:unknown[] = [];

  for (const job of jobs ?? []) {
    try {
      const [result] = await runClaimedJobs({jobs:[job],db,mode,testThreads,decide:decideMailboxThread,repairEngine});
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      try {
        await db.audit({jobId:job.id,threadId:job.thread_id,action:'worker_error',outcome:'failed',details:{message}});
      } catch {}
      try {
        await db.finish({jobId:job.id,claimToken:job.claim_token,status:job.attempt_count < 2 ? 'pending':'failed',error:message});
      } catch {}
      results.push({status:'error'});
    }
  }
  return NextResponse.json({ok:true,mode,enqueued,processed:results.length,results});
}
