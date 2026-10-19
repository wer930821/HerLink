const MODES = new Set(['disabled','dry_run','allowlist','production']);

export function operatorMode(env = process.env) {
  const mode = env.STATION_OPERATOR_MODE;
  return MODES.has(mode) ? mode : 'disabled';
}

function allowlist(env) {
  return new Set(String(env.STATION_OPERATOR_TEST_THREADS ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean));
}

export function canProcessThread(threadId, env = process.env) {
  const mode = operatorMode(env);
  if (mode === 'disabled') return false;
  if (mode === 'allowlist') return allowlist(env).has(threadId);
  return true;
}

export function canMutate(env = process.env) {
  const mode = operatorMode(env);
  return mode === 'allowlist' || mode === 'production';
}
