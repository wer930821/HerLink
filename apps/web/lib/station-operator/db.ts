import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Job = { id:string; thread_id:string; trigger_message_id:string|null; claim_token:string; attempt_count:number };

function required(name:string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

export function createOperatorSupabase(): SupabaseClient {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
  });
}

export function createOperatorDb(client = createOperatorSupabase()) {
  const rpc = async <T>(name:string, args:Record<string,unknown> = {}) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data as T;
  };
  return {
    enqueue: (limit=20) => rpc<number>('station_operator_enqueue_unread',{p_limit:limit}),
    claim: (limit=5) => rpc<Job[]>('station_operator_claim',{p_limit:limit}),
    messages: async (threadId:string) => {
      const data = await rpc<any[]>('station_operator_messages',{p_thread_id:threadId});
      return (data ?? []).map(m => ({sender_role:m.sender_role, body:m.body, created_at:m.created_at}));
    },
    latestUserMessage: async (threadId:string) => {
      const { data, error } = await client.from('station_mail_messages').select('id').eq('thread_id',threadId).eq('sender_role','user').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    replyAndFinish: ({jobId,claimToken,body,result}:{jobId:string;claimToken:string;body:string;result?:unknown}) =>
      rpc<string>('station_operator_reply_and_finish',{p_job_id:jobId,p_claim_token:claimToken,p_body:body,p_result:result ?? {}}),
    finish: ({jobId,claimToken,status,result,error}:{jobId:string;claimToken:string;status:string;result?:unknown;error?:string}) =>
      rpc<boolean>('station_operator_finish',{p_job_id:jobId,p_claim_token:claimToken,p_status:status,p_result:result ?? {},p_error:error ?? null}),
    audit: async ({jobId,threadId,action,outcome,details}:{jobId:string;threadId:string;action:string;outcome:string;details?:unknown}) => {
      const { error } = await client.from('station_operator_audit').insert({job_id:jobId,thread_id:threadId,action,outcome,details:details ?? {}});
      if (error) throw error;
    },
    createBugRepair: ({job,risk,summary}:{job:Job;risk:string;summary:string}) =>
      rpc<string>('station_operator_create_repair',{p_job_id:job.id,p_claim_token:job.claim_token,p_risk:risk,p_summary:summary}),
    repair: async (repairId:string) => {
      const { data, error } = await client.from('station_operator_repairs').select('id,job_id,risk,status,attempt_count,summary').eq('id',repairId).maybeSingle();
      if (error) throw error;
      return data;
    },
    dispatchQueuedRepair: (repairId:string) =>
      rpc<any[]>('station_operator_dispatch_queued_repair',{p_repair_id:repairId}).then(rows => rows?.[0] ?? null),
    applyRepairEvent: ({repairId,event,metadata}:{repairId:string;event:string;metadata?:Record<string,unknown>}) =>
      rpc<{status:string;changed:boolean}>('station_operator_apply_repair_event',{p_repair_id:repairId,p_event:event,p_metadata:metadata ?? {}}),
    finalizeVerifiedRepair: ({repairId,body}:{repairId:string;body:string}) =>
      rpc<{status:string;changed:boolean;reason?:string;replyMessageId?:string}>('station_operator_finalize_verified_repair',{p_repair_id:repairId,p_body:body})
  };
}
