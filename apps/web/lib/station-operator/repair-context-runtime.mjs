import { buildRepairContextQuery, validateRepairContextFiles } from './repair-context.mjs';

const MAX_TOTAL_BYTES=120000;

function normalizeRoot(value) {
  const root=String(value ?? '').replace(/\\/g,'/').replace(/^\.\//,'');
  return root.endsWith('/') ? root : `${root}/`;
}

function withinRoots(path,roots) {
  return roots.some(root=>path.startsWith(root));
}

export async function discoverRepairContext({summary,allowedRoots=[],search,readFile}={}) {
  if (typeof search !== 'function' || typeof readFile !== 'function') return {ok:false,reason:'missing_capability'};
  const roots=Array.isArray(allowedRoots) ? allowedRoots.map(normalizeRoot).filter(Boolean) : [];
  if (!roots.length) return {ok:false,reason:'invalid_allowed_roots'};

  const built=buildRepairContextQuery({summary});
  if (!built.ok) return built;

  try {
    const found=await search(built.query);
    const guarded=validateRepairContextFiles(found);
    if (!guarded.ok) return guarded;
    if (guarded.files.some(path=>!withinRoots(path,roots))) return {ok:false,reason:'outside_allowed_roots'};

    const context=[];
    let total=0;
    for (const path of guarded.files) {
      const content=String(await readFile(path) ?? '');
      total+=Buffer.byteLength(content,'utf8');
      if (total>MAX_TOTAL_BYTES) return {ok:false,reason:'context_too_large'};
      context.push({path,content});
    }
    return {ok:true,context};
  } catch {
    return {ok:false,reason:'context_discovery_failed'};
  }
}
