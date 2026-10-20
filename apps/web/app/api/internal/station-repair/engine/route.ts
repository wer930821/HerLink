import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createOperatorDb } from '../../../../../lib/station-operator/db';

export const runtime='nodejs';

const SOURCE_ROOTS=['app/','components/','lib/','__tests__/'];
const SOURCE_EXT=/\.(?:[cm]?[jt]sx?|mjs)$/i;
const MAX_SCAN_FILES=600;
const MAX_SOURCE_FILE_BYTES=50000;
const WEB_ROOT=path.resolve(process.cwd());
const SAFE_REPOSITORY=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
type RepairContextInput={summary?:string;allowedRoots?:string[]};
type RepairFile={path:string;content:string};

function sourcePath(relativePath:string) {
  const normalized=relativePath.replace(/\\/g,'/').replace(/^\.\//,'');
  if (!normalized.startsWith('apps/web/')) throw new Error('outside_source_root');
  const resolved=path.resolve(WEB_ROOT,normalized.slice('apps/web/'.length));
  const relative=path.relative(WEB_ROOT,resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outside_source_root');
  return resolved;
}

async function safeSourceFile(relativePath:string) {
  const resolved=sourcePath(relativePath);
  const info=await fs.stat(resolved);
  if (!info.isFile() || info.size>MAX_SOURCE_FILE_BYTES) throw new Error('source_file_not_allowed');
  return resolved;
}

async function walkSourceFiles() {
  const out:string[]=[];
  async function walk(relative:string) {
    if (out.length>=MAX_SCAN_FILES) return;
    const directory=path.resolve(WEB_ROOT,relative);
    const contained=path.relative(WEB_ROOT,directory);
    if (!contained || contained.startsWith('..') || path.isAbsolute(contained)) throw new Error('outside_source_root');
    const entries=(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length>=MAX_SCAN_FILES) return;
      const child=path.posix.join(relative.replace(/\\/g,'/'),entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        const file=`apps/web/${child}`;
        try { await safeSourceFile(file); out.push(file); } catch { /* skip unsafe or oversized source */ }
      }
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
    try { content=await fs.readFile(await safeSourceFile(file),'utf8'); } catch { continue; }
    const haystack=`${file}\n${content}`.toLowerCase();
    const score=terms.reduce((sum,term)=>sum+(haystack.includes(term)?1:0),0);
    if (score>0) scored.push({path:file,score});
  }
  return scored.sort((a,b)=>b.score-a.score || a.path.localeCompare(b.path)).slice(0,5).map(item=>item.path);
}

async function readBundledSource(file:string) {
  return fs.readFile(await safeSourceFile(file),'utf8');
}

function githubCapabilities() {
  const token=process.env.STATION_REPAIR_GITHUB_TOKEN;
  const repository=process.env.STATION_REPAIR_GITHUB_REPOSITORY;
  if (!token || !repository || !SAFE_REPOSITORY.test(repository)) return null;
  const api=`https://api.github.com/repos/${repository}`;
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
  const call=async (url:string,init:RequestInit={})=>{
    const response=await fetch(url,{...init,headers:{...headers,...(init.headers ?? {})},cache:'no-store'});
    if (!response.ok) throw new Error('github_request_failed');
    return response.status===204 ? null : response.json();
  };
  return {
    resolveBaseSha:async ()=>{
      const ref=await call(`${api}/git/ref/heads/main`);
      return String(ref?.object?.sha ?? '');
    },
    createBranch:async ({branch,baseSha}:{branch:string;baseSha:string})=>{
      await call(`${api}/git/refs`,{method:'POST',body:JSON.stringify({ref:`refs/heads/${branch}`,sha:baseSha})});
      return {ok:true};
    },
    writeFiles:async ({branch,files}:{branch:string;files:RepairFile[]})=>{
      let commitSha='';
      for (const file of files) {
        const encodedPath=file.path.split('/').map(encodeURIComponent).join('/');
        let sha: string|undefined;
        const existing=await fetch(`${api}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,{headers,cache:'no-store'});
        if (existing.ok) sha=String((await existing.json()).sha ?? '') || undefined;
        else if (existing.status!==404) throw new Error('github_read_failed');
        const body:{message:string;content:string;branch:string;sha?:string}={message:`fix: autonomous repair ${file.path}`,content:Buffer.from(file.content,'utf8').toString('base64'),branch};
        if (sha) body.sha=sha;
        const written=await call(`${api}/contents/${encodedPath}`,{method:'PUT',body:JSON.stringify(body)});
        commitSha=String(written?.commit?.sha ?? '');
      }
      return {ok:true,commitSha};
    },
    createDraftPr:async ({head,base,draft,title,body}:{head:string;base:string;draft:boolean;title:string;body:string})=>{
      const opened=await call(`${api}/pulls`,{method:'POST',body:JSON.stringify({head,base,draft,title,body})});
      return {ok:true,prNumber:Number(opened?.number)};
    }
  };
}

export async function POST(request:Request) {
  const { handleRepairEngineHttp } = await import('../../../../../lib/station-operator/repair-engine-http.mjs');
  const { buildRepairEngineRuntime } = await import('../../../../../lib/station-operator/repair-engine-runtime.mjs');
  const { executeRepairEngine } = await import('../../../../../lib/station-operator/repair-engine-route.mjs');
  const { callRepairModel } = await import('../../../../../lib/station-operator/repair-openai.mjs');
  const { discoverRepairContext } = await import('../../../../../lib/station-operator/repair-context-runtime.mjs');
  const { executeRepairGitHubWrite } = await import('../../../../../lib/station-operator/repair-github.mjs');
  let payload:unknown;
  try { payload=await request.json(); }
  catch { return NextResponse.json({ok:false},{status:400}); }

  try {
    const capabilities=githubCapabilities();
    const engine=buildRepairEngineRuntime({
      execute:executeRepairEngine,
      discoverContext:(input:RepairContextInput)=>discoverRepairContext({...input,search:searchBundledSource,readFile:readBundledSource}),
      callModel:callRepairModel,
      writeRepair:async (input:Record<string,unknown>) => capabilities
        ? executeRepairGitHubWrite(input,capabilities)
        : ({ok:false,reason:'missing_capability'})
    });
    const result=await handleRepairEngineHttp({
      authorization:request.headers.get('authorization'),
      secret:process.env.STATION_REPAIR_CALLBACK_SECRET,
      mode:process.env.STATION_OPERATOR_MODE,
      payload,
      db:createOperatorDb(),
      resolveBaseSha:capabilities?.resolveBaseSha,
      execute:engine.execute
    });
    return NextResponse.json(result.body,{status:result.status});
  } catch {
    return NextResponse.json({ok:false},{status:500});
  }
}