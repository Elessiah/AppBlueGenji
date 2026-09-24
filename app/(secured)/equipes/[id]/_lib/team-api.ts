import { TERMS_ACCEPTANCE_REQUIRED, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";

/**
 * Appel d'une route d'équipe, refus compris.
 *
 * Chaque geste de la fiche recopiait les quatre mêmes lignes (`fetch`, `json`,
 * `ok`, repli), et deux défauts avec elles : une réponse qui n'est pas du JSON
 * (proxy en panne, page d'erreur HTML) faisait lever `response.json()` avec un
 * message de moteur JavaScript — « Unexpected token '<' » — que le toast
 * affichait tel quel ; et une coupure réseau sortait en « Failed to fetch ».
 * Ici, tout refus devient un **code**, que `teamErrorMessage` sait dire.
 */
export async function teamApi<T = Record<string, unknown>>(
  url: string,
  init: RequestInit | undefined,
  fallbackCode: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("NETWORK_ERROR");
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    // Un geste de gestion refusé faute d'avoir accepté les conditions : la
    // modale d'acceptation (mise en page racine) s'ouvre, le toast dit pourquoi.
    if (payload.error === TERMS_ACCEPTANCE_REQUIRED) window.dispatchEvent(new Event(TERMS_REQUIRED_EVENT));
    throw new Error(payload.error || fallbackCode);
  }
  return payload;
}

/** Options d'une requête JSON. */
export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
