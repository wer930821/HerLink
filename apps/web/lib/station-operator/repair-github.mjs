import { validateRepairPlan } from './repair-dispatch.mjs';

const SAFE_SHA = /^[A-Fa-f0-9]{40}$/;
const SAFE_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_MUTATION_FIELDS = ['command','target','ref','script','shell','exec'];

function sanitizeCause(value) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
}

export function buildRepairGitHubWriteRequest(input = {}) {
  const { jobId, baseSha, files, cause } = input;
  const expectedBranch = `ai-repair/${jobId}`;

  if (!SAFE_JOB_ID.test(String(jobId ?? ''))) return { ok: false, reason: 'invalid_job_id' };
  if (!SAFE_SHA.test(String(baseSha ?? ''))) return { ok: false, reason: 'invalid_base_sha' };
  if (input.branch !== undefined && input.branch !== expectedBranch) return { ok: false, reason: 'branch_mismatch' };
  if (input.force !== undefined && input.force !== false) return { ok: false, reason: 'force_forbidden' };
  if (input.draft !== undefined && input.draft !== true) return { ok: false, reason: 'draft_required' };
  if (input.base !== undefined && input.base !== 'main') return { ok: false, reason: 'base_mismatch' };
  if (FORBIDDEN_MUTATION_FIELDS.some(field=>field in input)) return { ok: false, reason: 'arbitrary_mutation_forbidden' };

  const validated = validateRepairPlan({ files });
  if (!validated.ok) return { ok: false, reason: 'unsafe_plan', detail: validated.reason };

  return {
    ok: true,
    request: {
      branch: expectedBranch,
      baseSha,
      base: 'main',
      draft: true,
      force: false,
      title: `fix: autonomous repair ${jobId}`,
      body: `Automated low-risk repair. Cause: ${sanitizeCause(cause)}`,
      files: validated.files,
    },
  };
}

export async function executeRepairGitHubWrite(input = {}, capabilities = {}) {
  const built = buildRepairGitHubWriteRequest(input);
  if (!built.ok) return built;

  const { createBranch, writeFiles, createDraftPr } = capabilities;
  if (typeof createBranch !== 'function' || typeof writeFiles !== 'function' || typeof createDraftPr !== 'function') {
    return { ok: false, reason: 'missing_capability' };
  }

  const request = built.request;
  try {
    const branched = await createBranch({ branch: request.branch, baseSha: request.baseSha });
    if (!branched?.ok) return { ok: false, reason: 'branch_create_failed' };

    const written = await writeFiles({ branch: request.branch, files: request.files });
    if (!written?.ok || !SAFE_SHA.test(String(written.commitSha ?? ''))) {
      return { ok: false, reason: 'file_write_failed' };
    }

    const opened = await createDraftPr({
      head: request.branch,
      base: request.base,
      draft: true,
      title: request.title,
      body: request.body,
    });
    if (!opened?.ok || !Number.isInteger(Number(opened.prNumber)) || Number(opened.prNumber) < 1) {
      return { ok: false, reason: 'pr_create_failed' };
    }

    return {
      ok: true,
      branch: request.branch,
      prNumber: Number(opened.prNumber),
      commitSha: written.commitSha,
    };
  } catch {
    return { ok: false, reason: 'github_write_failed' };
  }
}
