import { NextResponse } from 'next/server';
import { createOperatorDb } from '../../../../../lib/station-operator/db';

export const runtime='nodejs';

export async function POST(request:Request) {
  const { handleRepairEngineHttp } = await import('../../../../../lib/station-operator/repair-engine-http.mjs');
  let payload:unknown;
  try { payload=await request.json(); }
  catch { return NextResponse.json({ok:false},{status:400}); }

  try {
    const result=await handleRepairEngineHttp({
      authorization:request.headers.get('authorization'),
      secret:process.env.STATION_REPAIR_CALLBACK_SECRET,
      mode:process.env.STATION_OPERATOR_MODE,
      payload,
      db:createOperatorDb(),
      execute:async () => ({ok:false,reason:'runtime_not_wired'})
    });
    return NextResponse.json(result.body,{status:result.status});
  } catch {
    return NextResponse.json({ok:false},{status:500});
  }
}
