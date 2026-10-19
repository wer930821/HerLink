import { NextResponse } from 'next/server';
import { createOperatorDb } from '../../../../../lib/station-operator/db';

export const runtime='nodejs';

export async function POST(request:Request) {
  const { handleRepairCallback } = await import('../../../../../lib/station-operator/repair-callback.mjs');
  let payload:unknown;
  try { payload=await request.json(); }
  catch { return NextResponse.json({ok:false},{status:400}); }

  try {
    const result=await handleRepairCallback({
      authorization:request.headers.get('authorization'),
      secret:process.env.STATION_REPAIR_CALLBACK_SECRET,
      payload,
      db:createOperatorDb()
    });
    return NextResponse.json(result.body,{status:result.status});
  } catch {
    return NextResponse.json({ok:false},{status:500});
  }
}
