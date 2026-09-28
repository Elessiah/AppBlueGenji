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
  LOGO_FILE_MISSING:
    "Le fichier de ce logo n'existe plus : il n'y a rien à masquer. Utilise « Supprimer le logo » pour vider la fiche.",
  QUARANTINE_NOT_FOUND: "Cette image masquée n'existe plus.",
  QUARANTINE_CLOSED: "Cette image a déjà été rétablie ou supprimée.",
  TEAM_HAS_NEW_LOGO: "L'équipe a envoyé un nouveau logo depuis : l'ancien ne peut pas le remplacer.",
  TEAM_NOT_FOUND: "Cette équipe n'existe plus.",
  USER_NOT_TARGETED: "Ce signalement ne vise pas ce joueur.",
  USER_HAS_NO_AVATAR: "Le joueur n'a déjà plus d'avatar.",
  AVATAR_CHANGED: "Le joueur vient de changer d'avatar : vérifie le nouveau avant d'agir.",
  AVATAR_NOT_MOVABLE: "Cet avatar n'est pas un fichier du site : il ne peut pas être masqué.",
  AVATAR_FILE_MISSING:
    "Le fichier de cet avatar n'existe plus : il n'y a rien à masquer. Utilise « Supprimer l'avatar » pour vider la fiche.",
  USER_HAS_NEW_AVATAR: "Le joueur a envoyé un nouvel avatar depuis : l'ancien ne peut pas le remplacer.",
  INVALID_TARGET_TYPE: "Cible inconnue.",
  INVALID_TARGET_ID: "Identifiant invalide.",
  REPORTS_LOAD_FAILED: "Les signalements n'ont pas pu être chargés.",
  REPORT_ACTION_FAILED: "Le geste n'a pas pu être enregistré.",
  LOGO_HIDE_FAILED: "L'image n'a pas pu être masquée.",
  LOGO_RESTORE_FAILED: "L'image n'a pas pu être rétablie.",
  LOGO_PURGE_FAILED: "L'image n'a pas pu être supprimée.",
  TEAM_LOGO_REMOVE_FAILED: "L'image n'a pas pu être retirée.",
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
