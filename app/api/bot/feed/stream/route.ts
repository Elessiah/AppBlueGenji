export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
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
    return new Response('event: error\ndata: BOT_UNREACHABLE\n\n', { status: 503, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(`event: error\ndata: BOT_${upstream.status}\n\n`, { status: 502, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
