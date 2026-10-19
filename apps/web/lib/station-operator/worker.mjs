export async function processClaimedJob({ job, db, decide }) {
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
    await db.finish({jobId:job.id,claimToken:job.claim_token,status:'human_review',result:{decision}});
    return { status:'human_review' };
  }

  if (decision.kind === 'bug_repair') {
    await db.createBugRepair({job,decision,messages});
    await db.audit({jobId:job.id,threadId:job.thread_id,action:'bug_repair',outcome:'queued',details:{confidence:decision.confidence}});
    await db.finish({jobId:job.id,claimToken:job.claim_token,status:'waiting_ci',result:{decision}});
    return { status:'waiting_ci' };
  }

  if (decision.kind === 'reply' && decision.reply) {
    await db.replyAndFinish({jobId:job.id,claimToken:job.claim_token,body:decision.reply,result:{decision}});
    return { status:'completed' };
  }

  await db.audit({jobId:job.id,threadId:job.thread_id,action:'ignore',outcome:'completed',details:{kind:decision.kind}});
  await db.finish({jobId:job.id,claimToken:job.claim_token,status:'completed',result:{decision}});
  return { status:'completed' };
}
