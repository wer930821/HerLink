const HIGH_RISK = [
  /production\s+migration/i,/正式.{0,8}(資料|migration|資料庫)/i,/刪除.{0,8}(資料|帳號|紀錄)/i,
  /service[_ -]?role/i,/secret|api[_ -]?key|token/i,/付款|billing|payment/i,/權限|管理員|permission|privilege/i
];

export function repairRisk({actions=[],messages=[]}) {
  if (actions.some(a => a !== 'create_bug_repair')) return 'high';
  const text=messages.map(m => String(m?.body ?? '')).join('\n').slice(0,12000);
  return HIGH_RISK.some(pattern => pattern.test(text)) ? 'high' : 'low';
}

function safeSummary(messages=[]) {
  const text=messages.map(m => String(m?.body ?? '')).join(' ').replace(/(?:OPENAI|SUPABASE|VERCEL|GITHUB)?_?(?:API_)?(?:KEY|TOKEN|SECRET)\s*=\s*\S+/gi,'[redacted]');
  return text.replace(/\s+/g,' ').trim().slice(0,800);
}

export function repairPayload({job,decision,messages}) {
  return {
    jobId:job.id,
    threadId:job.thread_id,
    triggerMessageId:job.trigger_message_id,
    confidence:Number(decision?.confidence ?? 0),
    summary:safeSummary(messages)
  };
}
