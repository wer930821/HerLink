import { NextResponse } from 'next/server';
import { createOperatorDb } from '@/lib/station-operator/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(header:string|null) {
  const secret = process.env.STATION_OPERATOR_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  return header.slice(7) === secret;
}

export async function POST(request:Request) {
  if (!authorized(request.headers.get('authorization'))) return NextResponse.json({ok:false,error:'unauthorized'},{status:401});
  if (process.env.STATION_OPERATOR_ENABLED !== 'true') return NextResponse.json({ok:true,disabled:true,processed:0});

  const db = createOperatorDb();
  const enqueued = await db.enqueue(20);
  const jobs = await db.claim(5);
  const results:unknown[] = [];

  // Worker/OpenAI modules are .mjs and intentionally kept runtime-only so secrets never reach the client.
  const [{processClaimedJob},{decideMailboxThread}] = await Promise.all([
    import('../../../../lib/station-operator/worker.mjs'),
    import('../../../../lib/station-operator/openai.mjs')
  ]);

  for (const job of jobs ?? []) {
    try {
      results.push(await processClaimedJob({job,db,decide:decideMailboxThread}));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await db.audit({jobId:job.id,threadId:job.thread_id,action:'worker_error',outcome:'failed',details:{message}});
      await db.finish({jobId:job.id,claimToken:job.claim_token,status:job.attempt_count < 2 ? 'pending':'failed',error:message});
      results.push({status:'error'});
    }
  }
  return NextResponse.json({ok:true,enqueued,processed:results.length,results});
}
