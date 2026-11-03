/**
 * Ce qu'une ligne d'échec de pm2 dit d'une erreur : **un code, jamais un
 * texte libre**. Le code de l'erreur (`ER_…`, `ECONNREFUSED`) ; sinon son
 * message s'il est lui-même un code du site (`BOT_DOWN`, `MATCH_NOT_FOUND`) ;
 * sinon son seul nom (`TypeError`). Pile, requête, `sqlMessage` de mysql2,
 * message d'un `JSON.parse` ou corps d'une réponse du bot pourraient porter
 * des valeurs lues (un `ER_DUP_ENTRY` cite la valeur en double), alors que le
 * registre (T05) et /rgpd décrivent ces lignes comme le geste et le numéro,
 * sans plus. Une seule règle pour tous les journaux d'échec (journal du staff,
 * avis de cast, rafales regroupées, push).
 */
export function failureReason(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  if (error instanceof Error) return ERROR_CODE.test(error.message) ? error.message : error.name;
  return "erreur inconnue";
}

/** Forme d'un code d'erreur du site : majuscules, chiffres et soulignés. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
