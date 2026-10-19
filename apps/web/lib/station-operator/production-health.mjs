export async function verifyProductionHealth({ url, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'user-agent': 'HerLink-Station-Repair-Health/1.0' }
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function decideProductionRepair({ deploymentStatus, healthCheck }) {
  if (deploymentStatus === 'TIMEOUT') return { action: 'human_review', reason: 'deployment_timeout' };
  if (deploymentStatus !== 'READY') return { action: 'human_review', reason: 'deployment_failed' };
  try {
    if (!(await healthCheck())) return { action: 'human_review', reason: 'health_failed' };
  } catch {
    return { action: 'human_review', reason: 'health_failed' };
  }
  return { action: 'complete' };
}