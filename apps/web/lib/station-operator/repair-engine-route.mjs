import { buildRepairModelRequest, prepareValidatedRepairPlan } from './repair-engine.mjs';

const MAX_ATTEMPTS = 2;
const SAFE_SHA = /^[A-Fa-f0-9]{40}$/;

export function validateRepairEngineInvocation({ authenticated, mode, repair, request } = {}) {
  if (authenticated !== true) return { ok: false, reason: 'unauthenticated' };
  if (mode !== 'allowlist') return { ok: false, reason: 'mode_not_allowed' };
  if (!repair || !request) return { ok: false, reason: 'missing_input' };
  if (repair.risk !== 'low') return { ok: false, reason: 'risk_not_allowed' };
  if (repair.status !== 'queued') return { ok: false, reason: 'status_not_allowed' };
  if (repair.id !== request.repairId || repair.job_id !== request.jobId) return { ok: false, reason: 'identity_mismatch' };
  const expectedBranch = `ai-repair/${request.jobId}`;
  if (request.branch !== expectedBranch) return { ok: false, reason: 'branch_mismatch' };
  if (!SAFE_SHA.test(String(request.baseSha ?? ''))) return { ok: false, reason: 'invalid_base_sha' };
  const attempt = Number(request.attempt);
  const storedAttempt = Number(repair.attempt_count);
  const expectedAttempt = storedAttempt === 0 ? 1 : storedAttempt;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) return { ok: false, reason: 'attempt_not_allowed' };
  if (!Number.isInteger(storedAttempt) || storedAttempt < 0 || storedAttempt > MAX_ATTEMPTS || expectedAttempt !== attempt) return { ok: false, reason: 'attempt_mismatch' };
  return { ok: true };
}

export async function executeRepairEngine({ authenticated, mode, repair, request, discoverContext, callModel, writeRepair } = {}) {
  const gate = validateRepairEngineInvocation({ authenticated, mode, repair, request });
  if (!gate.ok) return gate;
  if (typeof discoverContext !== 'function' || typeof callModel !== 'function' || typeof writeRepair !== 'function') return { ok: false, reason: 'missing_capability' };
  try {
    const discovered = await discoverContext({ summary: request.summary, allowedRoots: request.allowedRoots });
    if (!discovered?.ok) return { ok: false, reason: discovered?.reason ?? 'context_discovery_failed' };
    const modelRequest = buildRepairModelRequest({ request, context: discovered.context });
    if (!modelRequest.ok) return modelRequest;
    const raw = await callModel(modelRequest);
    const plan = prepareValidatedRepairPlan({ raw });
    if (!plan.ok) return plan;
    const written = await writeRepair({jobId:request.jobId,repairId:request.repairId,branch:request.branch,baseSha:request.baseSha,cause:plan.cause,confidence:plan.confidence,files:plan.files});
    if (!written?.ok) return { ok: false, reason: written?.reason ?? 'write_failed' };
    return { ok: true, branch: written.branch, prNumber: written.prNumber };
  } catch {
    return { ok: false, reason: 'engine_failed' };
  }
}
