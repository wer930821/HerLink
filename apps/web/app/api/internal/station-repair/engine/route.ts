import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createOperatorDb } from '../../../../../lib/station-operator/db';

export const runtime='nodejs';

const SOURCE_ROOTS=['app/','components/','lib/','__tests__/'];
const SOURCE_EXT=/\.(?:[cm]?[jt]sx?|mjs)$/i;
const MAX_SCAN_FILES=600;

function sourcePath(relativePath:string) {
  const normalized=relativePath.replace(/\\/g,'/').replace(/^\.\//,'');
  if (!normalized.startsWith('apps/web/')) throw new Error('outside_source_root');
  return path.join(process.cwd(),normalized.slice('apps/web/'.length));
}

async function walkSourceFiles() {
  const out:string[]=[];
  async function walk(relative:string) {
    if (out.length>=MAX_SCAN_FILES) return;
    const entries=await fs.readdir(path.join(process.cwd(),relative),{withFileTypes:true});
    for (const entry of entries) {
      if (out.length>=MAX_SCAN_FILES) return;
      const child=path.posix.join(relative.replace(/\\/g,'/'),entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && SOURCE_EXT.test(entry.name)) out.push(`apps/web/${child}`);
    }
  }
  for (const root of SOURCE_ROOTS) {
    try { await walk(root); } catch { /* unreadable roots simply produce no candidates */ }
  }
  return out;
}

async function searchBundledSource(query:string) {
  const terms=String(query).toLowerCase().split(/\s+/).filter(term=>term.length>=3).slice(0,12);
  if (!terms.length) return [];
  const files=await walkSourceFiles();
  const scored:Array<{path:string;score:number}>=[];
  for (const file of files) {
    let content='';
    try { content=await fs.readFile(sourcePath(file),'utf8'); } catch { continue; }
    const haystack=`${file}\n${content}`.toLowerCase();
    const score=terms.reduce((sum,term)=>sum+(haystack.includes(term)?1:0),0);
    if (score>0) scored.push({path:file,score});
  }
  return scored.sort((a,b)=>b.score-a.score || a.path.localeCompare(b.path)).slice(0,5).map(item=>item.path);
}

async function readBundledSource(file:string) {
  return fs.readFile(sourcePath(file),'utf8');
}

export async function POST(request:Request) {
  const { handleRepairEngineHttp } = await import('../../../../../lib/station-operator/repair-engine-http.mjs');
  const { buildRepairEngineRuntime } = await import('../../../../../lib/station-operator/repair-engine-runtime.mjs');
  const { executeRepairEngine } = await import('../../../../../lib/station-operator/repair-engine-route.mjs');
  const { callRepairModel } = await import('../../../../../lib/station-operator/repair-openai.mjs');
  const { discoverRepairContext } = await import('../../../../../lib/station-operator/repair-context-runtime.mjs');
  let payload:unknown;
  try { payload=await request.json(); }
  catch { return NextResponse.json({ok:false},{status:400}); }

  try {
    const engine=buildRepairEngineRuntime({
      execute:executeRepairEngine,
      discoverContext:input=>discoverRepairContext({...input,search:searchBundledSource,readFile:readBundledSource}),
      callModel:callRepairModel,
      writeRepair:async () => ({ok:false,reason:'github_writer_not_wired'})
    });
    const result=await handleRepairEngineHttp({
      authorization:request.headers.get('authorization'),
      secret:process.env.STATION_REPAIR_CALLBACK_SECRET,
      mode:process.env.STATION_OPERATOR_MODE,
      payload,
      db:createOperatorDb(),
      execute:engine.execute
    });
    return NextResponse.json(result.body,{status:result.status});
  } catch {
    return NextResponse.json({ok:false},{status:500});
  }
}
