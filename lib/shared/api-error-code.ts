/**
 * Ce qu'une réponse d'erreur de l'API a le droit de dire.
 *
 * Les refus du projet sont tous des **codes** en capitales (`TEAM_NOT_FOUND`,
 * `TOO_MANY_CODE_REQUESTS`…), que chaque écran traduit en français. Tout le
 * reste est un message d'exception que personne n'a écrit pour un lecteur :
 * `Table 'bluegenji.bg_…' doesn't exist`, `connect ECONNREFUSED 127.0.0.1:3306`,
 * `Unexpected token } in JSON at position 12`. La **forme** d'un code tient
 * donc lieu de liste blanche — une liste écrite à la main dériverait au premier
 * refus ajouté, et un refus légitime oublié ressortirait en générique.
 */

/** Forme d'un code d'erreur public : capitales, chiffres et soulignés. */
const PUBLIC_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Code rendu à la place d'un message non public, sur une erreur serveur (5xx). */
export const INTERNAL_ERROR = "INTERNAL_ERROR";

/** Code rendu à la place d'un message non public, sur un refus client (4xx). */
export const INVALID_REQUEST = "INVALID_REQUEST";

/**
 * Code rendu quand l'écriture a été **annulée par un interblocage** : une
 * autre écriture concurrente (typiquement un réordonnancement du seeding contre
 * une saisie de score) tenait les mêmes lignes, et la base a défait l'une des
 * deux. Rien n'a été écrit ; recommencer suffit. Rendu en **409** par `fail()`.
 */
export const CONCURRENT_UPDATE_RETRY = "CONCURRENT_UPDATE_RETRY";

/** Phrase d'interface de `CONCURRENT_UPDATE_RETRY`. */
export const CONCURRENT_UPDATE_RETRY_MESSAGE =
  "Une autre modification du tournoi est passée au même moment : rien n'a été enregistré. Réessaie.";

/** `true` si `message` a la forme d'un code d'erreur publiable. */
export function isPublicErrorCode(message: unknown): message is string {
  return typeof message === "string" && PUBLIC_ERROR_CODE.test(message);
}

/**
 * Le code à publier pour `message` : lui-même s'il en a la forme, sinon un
 * code générique qui dit seulement de quel côté est la faute.
 */
export function publicErrorCode(message: unknown, status: number): string {
  if (isPublicErrorCode(message)) return message;
  return status >= 500 ? INTERNAL_ERROR : INVALID_REQUEST;
}
