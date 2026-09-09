import { BOT_READ_RULE, enforceRateLimit, requestClientIp } from '@/lib/server/api-guard';
import { fetchBotActivity } from '@/lib/server/bot-integration';
import type { BotActivity } from '@/lib/shared/types';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  // Route publique (`/bot` est une page de vitrine) : le plafond porte donc sur
  // l'IP, faute de compte à qui l'imputer.
  const throttled = enforceRateLimit(BOT_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const url = new URL(req.url);
  const range = url.searchParams.get('range') ?? '30j';
  if (range !== '7j' && range !== '30j' && range !== '90j') {
    return Response.json({ error: 'INVALID_RANGE' }, { status: 400 });
  }
  const data: BotActivity | null = await fetchBotActivity(range);
  if (!data) {
    return Response.json({ error: 'BOT_UNREACHABLE' }, { status: 503 });
  }
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
