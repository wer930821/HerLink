import { repairRisk, repairPayload } from './repair.mjs';

export async function processClaimedJob({ job, db, decide, mode, repairEngine }) {
  const messages = await db.messages(job.thread_id);
  const decision = await decide({ messages });

  // Re-read after model latency. Never answer or retry an obsolete context.
  const latest = await db.latestUserMessage(job.thread_id);
  if (latest && latest !== job.trigger_message_id) {
    await db.audit({jobId:job.id,threadId:job.thread_id,action:'stale_context',outcome:'superseded',details:{latest}});
    await db.finish({jobId:job.id,claimToken:job.claim_token,status:'completed',result:{reason:'superseded',latest}});
    return { status:'superseded' };
  }

  if (decision.needsHuman || decision.kind === 'human_review') {
    await db.audit({jobId:job.id,threadId:job.thread_id,action:'human_review',outcome:'queued',details:{kind:decision.kind,actions:decision.actions}});
    await db.finish({jobId:job.id,claimToken:job.claim_token,status:'human_review',result:{kind:decision.kind}});
    return { status:'human_review' };
  }

  if (decision.kind === 'bug_repair') {
    const risk=repairRisk({actions:decision.actions,messages});
    const payload=repairPayload({job,decision,messages});
    if (risk === 'high') {
      await db.audit({jobId:job.id,threadId:job.thread_id,action:'bug_repair',outcome:'human_review',details:{risk,confidence:payload.confidence}});
      await db.finish({jobId:job.id,claimToken:job.claim_token,status:'human_review',result:{kind:'bug_repair',risk}});
      return { status:'human_review' };
    }
    const repairId=await db.createBugRepair({job,risk,summary:payload.summary});
    await db.audit({jobId:job.id,threadId:job.thread_id,action:'bug_repair',outcome:'queued',details:{repairId,risk,confidence:payload.confidence}});

    if (mode === 'allowlist' && typeof repairEngine === 'function') {
      let engineResult;
      try {
        engineResult = await repairEngine({repairId,jobId:job.id,risk});
      } catch {
        engineResult = {ok:false,reason:'engine_failed'};
      }
      if (!engineResult?.ok) {
        await db.audit({jobId:job.id,threadId:job.thread_id,action:'repair_engine',outcome:'human_review',details:{repairId,reason:String(engineResult?.reason ?? 'engine_failed').slice(0,200)}});
        await db.finish({jobId:job.id,claimToken:job.claim_token,status:'human_review',result:{repairId,risk,reason:'repair_engine_failed'}});
        return { status:'human_review' };
      }
    }

    await db.finish({jobId:job.id,claimToken:job.claim_token,status:'waiting_ci',result:{repairId,risk}});
    return { status:'waiting_ci' };
  }

  if (decision.kind === 'reply' && decision.reply) {
    await db.replyAndFinish({jobId:job.id,claimToken:job.claim_token,body:decision.reply,result:{kind:'reply'}});
    return { status:'completed' };
  }

  await db.audit({jobId:job.id,threadId:job.thread_id,action:'ignore',outcome:'completed',details:{kind:decision.kind}});
  await db.finish({jobId:job.id,claimToken:job.claim_token,status:'completed',result:{kind:decision.kind}});
  return { status:'completed' };
}
