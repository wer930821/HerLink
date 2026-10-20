import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const secret = process.env.STATION_OPERATOR_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'operator_secret_missing' }, { status: 500 });

  const url = new URL('/api/internal/station-operator', request.url);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({}),
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({ ok: false, error: 'invalid_operator_response' }));
  return NextResponse.json(body, { status: response.status });
}
