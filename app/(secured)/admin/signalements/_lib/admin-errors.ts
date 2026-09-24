/**
 * Refus des routes du panneau des signalements, dits en français. Un code
 * inconnu retombe sur une phrase, jamais sur lui-même.
 */
const ADMIN_REPORT_ERRORS: Record<string, string> = {
  UNAUTHORIZED: "Ta session a expiré : reconnecte-toi.",
  FORBIDDEN: "Ce panneau est réservé aux administrateurs.",
  NETWORK_ERROR: "Connexion impossible. Vérifie ton réseau puis réessaie.",
  REPORT_NOT_FOUND: "Ce signalement n'existe plus : il a peut-être été effacé.",
  REPORT_ACTION_NOT_ALLOWED: "Ce geste n'a plus de sens : le signalement a changé d'état entre-temps. La liste est rechargée.",
  INVALID_REPORT_ACTION: "Geste inconnu. Recharge la page.",
  TEAM_NOT_TARGETED: "Ce signalement ne vise pas cette équipe.",
  TEAM_HAS_NO_LOGO: "L'équipe n'a déjà plus de logo.",
  LOGO_CHANGED: "L'équipe vient de changer de logo : vérifie le nouveau avant d'agir.",
  LOGO_NOT_MOVABLE: "Ce logo n'est pas un fichier du site : il ne peut pas être masqué.",
  QUARANTINE_NOT_FOUND: "Ce logo masqué n'existe plus.",
  QUARANTINE_CLOSED: "Ce logo a déjà été rétabli ou supprimé.",
  TEAM_HAS_NEW_LOGO: "L'équipe a envoyé un nouveau logo depuis : l'ancien ne peut pas le remplacer.",
  TEAM_NOT_FOUND: "Cette équipe n'existe plus.",
  REPORTS_LOAD_FAILED: "Les signalements n'ont pas pu être chargés.",
  REPORT_ACTION_FAILED: "Le geste n'a pas pu être enregistré.",
  LOGO_HIDE_FAILED: "Le logo n'a pas pu être masqué.",
  LOGO_RESTORE_FAILED: "Le logo n'a pas pu être rétabli.",
  LOGO_PURGE_FAILED: "Le logo n'a pas pu être supprimé.",
  TEAM_LOGO_REMOVE_FAILED: "Le logo n'a pas pu être retiré.",
};

export function adminReportErrorMessage(code: string | null | undefined): string {
  if (code && Object.prototype.hasOwnProperty.call(ADMIN_REPORT_ERRORS, code)) return ADMIN_REPORT_ERRORS[code];
  return "L'opération a échoué. Réessaie dans un instant.";
}

/** Appel d'une route du panneau : tout refus devient un code. */
export async function adminFetch<T = Record<string, unknown>>(
  url: string,
  init: RequestInit | undefined,
  fallbackCode: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new Error("NETWORK_ERROR");
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallbackCode);
  return payload;
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
