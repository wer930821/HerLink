import { NextResponse } from 'next/server';
import { createOperatorDb } from '../../../../../lib/station-operator/db';

export const runtime='nodejs';

export async function POST(request:Request) {
  const { handleRepairEngineHttp } = await import('../../../../../lib/station-operator/repair-engine-http.mjs');
  const { buildRepairEngineRuntime } = await import('../../../../../lib/station-operator/repair-engine-runtime.mjs');
  const { executeRepairEngine } = await import('../../../../../lib/station-operator/repair-engine-route.mjs');
  const { callRepairModel } = await import('../../../../../lib/station-operator/repair-openai.mjs');
  let payload:unknown;
  try { payload=await request.json(); }
  catch { return NextResponse.json({ok:false},{status:400}); }

  try {
    const engine=buildRepairEngineRuntime({
      execute:executeRepairEngine,
      discoverContext:async () => ({ok:false,reason:'context_runtime_not_wired'}),
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
