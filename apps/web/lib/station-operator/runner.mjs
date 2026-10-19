import { processClaimedJob } from './worker.mjs';

export async function runClaimedJobs({jobs,db,mode,testThreads,decide}) {
  const results=[];
  for (const job of jobs ?? []) {
    if (mode === 'allowlist' && !testThreads.has(job.thread_id)) {
      await db.audit({jobId:job.id,threadId:job.thread_id,action:'rollout_gate',outcome:'not_allowed',details:{mode}});
      results.push({status:'not_allowed'});
      continue;
    }

    if (mode === 'dry_run') {
      const messages=await db.messages(job.thread_id);
      const decision=await decide({messages});
      const latest=await db.latestUserMessage(job.thread_id);
      await db.audit({jobId:job.id,threadId:job.thread_id,action:'dry_run',outcome:'observed',details:{kind:decision.kind,confidence:decision.confidence,needsHuman:decision.needsHuman,stale:Boolean(latest&&latest!==job.trigger_message_id)}});
      results.push({status:'dry_run'});
      continue;
    }

    results.push(await processClaimedJob({job,db,decide}));
  }
  return results;
}
