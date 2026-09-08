/**
 * Relais du flux d'activité du bot (SSE), pour le bandeau de la page `/bot`.
 *
 * Contrairement au flux d'un tournoi, il est **public** : `/bot` est une page de
 * vitrine. Il n'en est que plus exposé, car chaque lecteur y fait tenir deux
 * connexions — la sienne, et celle que l'on ouvre vers le bot pour l'alimenter.
 * D'où les deux gardes posées ici avant toute chose : un plafond de **rythme**
 * d'ouverture (`BOT_FEED_OPEN_RULE`) et un plafond de flux **simultanés**
 * (`lib/server/bot-feed-guard.ts`), le second couvrant le cas — courant sur une
 * page publique — où l'IP du visiteur n'est pas connue.
 *
 * La place réservée doit être rendue par **toutes** les portes de sortie : fin
 * du flux amont, erreur de lecture, annulation du corps par le runtime, abandon
 * de la requête par le client. Une seule oubliée, et le plafond se referme
 * définitivement au bout de quelques visites.
 */
import { BOT_FEED_OPEN_RULE, enforceRateLimit, requestClientIp } from '@/lib/server/api-guard';
import { acquireBotFeedSlot } from '@/lib/server/bot-feed-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const clientIp = requestClientIp(req);

  const throttled = enforceRateLimit(BOT_FEED_OPEN_RULE, clientIp);
  if (throttled) return throttled;

  const release = acquireBotFeedSlot(clientIp);
  if (!release) {
    return new Response('event: error\ndata: TOO_MANY_STREAMS\n\n', {
      status: 429,
      headers: { 'Content-Type': 'text/event-stream', 'Retry-After': '30' },
    });
  }

  const baseUrl = (process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:4400').replace(/\/+$/, '');
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (token) headers['x-internal-token'] = token;
  const lastEventId = req.headers.get('last-event-id');
  if (lastEventId) headers['last-event-id'] = lastEventId;

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/internal/feed/stream`, { headers, signal: req.signal, cache: 'no-store' });
  } catch {
    release();
    return new Response('event: error\ndata: BOT_UNREACHABLE\n\n', { status: 503, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (!upstream.ok || !upstream.body) {
    release();
    return new Response(`event: error\ndata: BOT_${upstream.status}\n\n`, { status: 502, headers: { 'Content-Type': 'text/event-stream' } });
  }

  // Le corps de l'amont est relayé au travers d'un flux à nous, dont la seule
  // raison d'être est de rendre la place : passer `upstream.body` tel quel ne
  // laisse aucun endroit où apprendre que la connexion s'est terminée.
  const reader = upstream.body.getReader();
  req.signal.addEventListener('abort', release);

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          release();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
