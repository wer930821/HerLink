const TRANSITIONS = {
  waiting_ci: {
    ci_success: 'waiting_deploy',
    ci_failure: 'human_review'
  },
  waiting_deploy: {
    deploy_success: 'verifying',
    deploy_failure: 'human_review'
  }
};

const DUPLICATES = new Set([
  'waiting_deploy:ci_success',
  'human_review:ci_failure',
  'verifying:deploy_success',
  'human_review:deploy_failure'
]);

export function applyRepairEvent({ status, event }) {
  const next = TRANSITIONS[status]?.[event];
  if (next) return { status: next, changed: true };
  if (DUPLICATES.has(`${status}:${event}`)) return { status, changed: false };
  throw new Error('invalid repair transition');
}
