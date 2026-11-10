/**
 * Envoie un geste JSON au serveur et rend le corps de la réponse (`{}` s'il est
 * illisible : un 5xx sans JSON rend son code générique, pas un message du
 * parseur). Un refus lève une `Error` dont le message est le **code** du
 * serveur, ou `fallback` quand il n'en porte pas. Une seule définition pour les
 * fenêtres de cast et la carte de match.
 */
export async function requestJson<T extends object = Record<string, unknown>>(
  url: string,
  options: Readonly<{ method?: string; body?: unknown }>,
  fallback: string,
): Promise<T & { error?: string }> {
  const { method = "GET", body } = options;
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}
