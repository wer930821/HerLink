import { validateRepairPlan } from './repair-dispatch.mjs';

const SAFE_SHA = /^[A-Fa-f0-9]{40}$/;
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function buildRepairGitHubWriteRequest(input = {}) {
  const { jobId, baseSha, files, cause } = input;
  const expectedBranch = `ai-repair/${jobId}`;

  if (!SAFE_JOB_ID.test(String(jobId ?? ''))) return { ok: false, reason: 'invalid_job_id' };
  if (!SAFE_SHA.test(String(baseSha ?? ''))) return { ok: false, reason: 'invalid_base_sha' };
  if (input.branch !== undefined && input.branch !== expectedBranch) return { ok: false, reason: 'branch_mismatch' };
  if (input.force !== undefined && input.force !== false) return { ok: false, reason: 'force_forbidden' };
  if ('command' in input || 'target' in input || 'ref' in input) return { ok: false, reason: 'arbitrary_mutation_forbidden' };

  const validated = validateRepairPlan({ files });
  if (!validated.ok) return { ok: false, reason: 'unsafe_plan', detail: validated.reason };

  return {
    ok: true,
    request: {
      branch: expectedBranch,
      baseSha,
      draft: true,
      force: false,
      title: `fix: autonomous repair ${jobId}`,
      body: `Automated low-risk repair.\n\nCause: ${String(cause ?? '').slice(0, 500)}`,
      files: validated.files,
    },
  };
}
