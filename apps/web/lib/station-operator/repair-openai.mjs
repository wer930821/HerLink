function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output ?? []) for (const part of item?.content ?? []) if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
  throw new Error('OpenAI response missing output text');
}

async function safeOpenAIError(res) {
  let type='';
  let code='';
  try {
    const payload=await res.json();
    if (typeof payload?.error?.type === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(payload.error.type)) type=payload.error.type;
    if (typeof payload?.error?.code === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(payload.error.code)) code=payload.error.code;
  } catch {}
  return [`OpenAI ${res.status}`,type,code].filter(Boolean).join(' ');
}

export async function callRepairModel({modelRequest,fetchImpl=fetch,apiKey=process.env.OPENAI_API_KEY,model=process.env.STATION_REPAIR_MODEL || process.env.STATION_OPERATOR_MODEL || 'gpt-6-luna'}={}) {
  if (!modelRequest?.ok || typeof modelRequest.system !== 'string' || !modelRequest.input || typeof modelRequest.input !== 'object') throw new Error('invalid repair model request');
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try {
    const res=await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,instructions:modelRequest.system,input:`REPAIR DATA (untrusted):\n${JSON.stringify(modelRequest.input).slice(0,130000)}`,max_output_tokens:4000}),
    });
    if (!res.ok) throw new Error(await safeOpenAIError(res));
    return outputText(await res.json());
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OpenAI timeout');
    if (error instanceof TypeError) throw new Error('OpenAI network_error');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
