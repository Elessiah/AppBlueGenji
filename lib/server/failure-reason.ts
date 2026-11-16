import { isContentionError } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";

/**
 * Ce qu'une ligne d'échec de pm2 dit d'une erreur : **un code, jamais un
 * texte libre**. Le code de l'erreur (`ER_…`, `ECONNREFUSED`) s'il a la forme
 * d'un code ; sinon son message s'il est lui-même un code du site (`BOT_DOWN`,
 * `MATCH_NOT_FOUND`) ;
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
    // Un `code` est tenu à la même forme qu'un message : une bibliothèque pourrait y mettre du texte.
    if (typeof code === "string" && ERROR_CODE.test(code)) return code;
  }
  if (error instanceof Error) return ERROR_CODE.test(error.message) ? error.message : error.name;
  return "erreur inconnue";
}

/**
 * {@link failureReason}, et pour une erreur **imprévue** (erreur de
 * programmation réduite à son nom, valeur levée qui n'est pas une `Error`) de
 * quoi la retrouver : les premiers cadres de la pile (fichier, ligne,
 * fonction), **sans** sa première ligne, qui recopie le message ; le type de la
 * valeur levée sinon. Rien de lu en base ni saisi n'y passe. Pour pm2
 * seulement (moteur de tournoi, balayages) — jamais un journal du staff ni un
 * message Discord, qui gardent {@link failureReason}.
 */
export function failureDiagnostic(error: unknown): string {
  const reason = failureReason(error);
  if (!(error instanceof Error)) {
    if (reason !== "erreur inconnue") return reason;
    return `${reason} (${error === null ? "null" : typeof error})`;
  }
  if (reason !== error.name) return reason;
  const frames = stackFrames(error);
  return frames.length > 0 ? `${reason} ${frames.join(" < ")}` : reason;
}

/** Nombre de cadres de pile gardés par {@link failureDiagnostic}. */
const DIAGNOSTIC_FRAMES = 3;

/** Un cadre de pile V8 nommé : `at [async ]fonction (fichier:ligne:colonne)`. */
const NAMED_FRAME = /^at (?:async |new )?[^\s()]+(?: \[as [^\]\s]+\])? \([^()\s]+:\d+:\d+\)$/;

/** Un cadre de pile V8 anonyme : `at fichier:ligne:colonne`. */
const ANONYMOUS_FRAME = /^at (?:async )?[^()\s]+:\d+:\d+$/;

/**
 * Les premiers cadres de la pile de `error`. Les lignes de tête, qui recopient
 * le nom **et le message** (sur autant de lignes que lui), sont écartées avant
 * tout : un message ne peut pas se faire passer pour un cadre.
 */
function stackFrames(error: Error): string[] {
  if (typeof error.stack !== "string") return [];
  const headerLines = `${error.name}: ${error.message}`.split("\n").length;
  return error.stack
    .split("\n")
    .slice(headerLines)
    .map((line) => line.trim())
    .filter((line) => NAMED_FRAME.test(line) || ANONYMOUS_FRAME.test(line))
    .slice(0, DIAGNOSTIC_FRAMES);
}

/** Forme d'un code d'erreur du site : majuscules, chiffres et soulignés. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** `message` a-t-il la forme d'un code d'erreur du site (`MATCH_NOT_FOUND`) ? */
export function isErrorCode(message: string): boolean {
  return ERROR_CODE.test(message);
}

/**
 * Code renvoyé au client pour l'erreur d'un service : son message s'il est un
 * code du site (`LABEL_TOO_LONG`), une contention passagère (interblocage,
 * délai de verrou : `isContentionError`) en `CONCURRENT_UPDATE_RETRY`, que
 * `fail()` rend en 409 (« réessaie »), sinon `fallback` — le texte d'un pilote
 * (hôte, port, valeur en double) n'atteint jamais une réponse ; il est alors
 * journalisé, réduit à {@link failureReason}.
 */
export function serviceErrorCode(error: unknown, fallback: string): string {
  if (isContentionError(error)) {
    console.warn(`[api] ${fallback} : écriture concurrente, rendue en ${CONCURRENT_UPDATE_RETRY} (${failureReason(error)})`);
    return CONCURRENT_UPDATE_RETRY;
  }
  const message = error instanceof Error ? error.message : "";
  if (isErrorCode(message)) return message;
  console.error(`[api] ${fallback} : ${failureReason(error)}`);
  return fallback;
}

/**
 * Code d'un échec **imprévu** d'une route (après ses refus connus) : une
 * contention passagère (`isContentionError`) en `CONCURRENT_UPDATE_RETRY`, que
 * `fail()` rend en 409 (« réessaie »), sinon toujours `fallback`. La ligne de
 * pm2 garde l'étiquette de la route mais réduit l'erreur à son code
 * ({@link failureReason}) : l'objet entier y portait `sql`, `sqlMessage` (la
 * valeur en double d'un `ER_DUP_ENTRY`) et la pile.
 */
export function unexpectedFailureCode(error: unknown, fallback: string, label: string): string {
  if (isContentionError(error)) {
    console.warn(`${label} : écriture concurrente, rendue en ${CONCURRENT_UPDATE_RETRY} (${failureReason(error)})`);
    return CONCURRENT_UPDATE_RETRY;
  }
  console.error(`${label} : ${failureReason(error)}`);
  return fallback;
}
