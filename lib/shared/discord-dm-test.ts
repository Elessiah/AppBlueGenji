/**
 * « Tester mes MP » (`docs/features/DISCORD_DM_TEST.md`) : logique pure, importable
 * partout.
 *
 * Un joueur vérifie depuis « Mon profil » que le bot BlueGenji peut lui écrire en
 * message privé : le site demande au bot un seul message de test, adressé au
 * compte Discord **rattaché** du joueur lui-même, puis dit le résultat. Le bot ne
 * rend qu'un bilan (`sent`, `unresolved`, `failed`) ; ce module en tire une issue
 * et choisit la notification qui la dit.
 */
import type { LocalizedDm } from "./dm-language";

/**
 * Issue d'un test parti jusqu'au bot :
 * - `SENT` : message remis ;
 * - `DMS_CLOSED` : membre du serveur BlueGenji, mais Discord refuse le message
 *   (messages privés fermés, bot bloqué) ;
 * - `NOT_IN_SERVER` : absent du serveur BlueGenji — le bot n'écrit qu'à ses membres.
 */
export const DM_TEST_OUTCOMES = ["SENT", "DMS_CLOSED", "NOT_IN_SERVER"] as const;
export type DmTestOutcome = (typeof DM_TEST_OUTCOMES)[number];

/** Codes de refus de `POST /api/profile/discord/dm-test` (code seul, jamais une phrase). */
export const DM_TEST_NOT_LINKED = "DISCORD_NOT_LINKED";
export const DM_TEST_NOT_CERTIFIED = "DISCORD_NOT_CERTIFIED";
export const DM_TEST_BOT_UNREACHABLE = "BOT_INTERNAL_UNREACHABLE";
export const DM_TEST_FAILED = "DISCORD_DM_TEST_FAILED";
/** Trop de tests en vol vers le bot : rien n'est parti, on réessaiera plus tard. */
export const DM_TEST_BUSY = "DISCORD_DM_TEST_BUSY";

/** Plafond par compte : quelques essais par heure, jamais une rafale de messages. */
export const DM_TEST_HOURLY_LIMIT = 3;

/**
 * Le bilan du bot, tel que `pushDiscordDirectMessages` le rend — lu comme du
 * JSON étranger : un champ peut manquer ou n'être pas du type attendu.
 */
export type DmTestReport = { sent?: unknown; unresolved?: unknown; failed?: unknown };

const hasEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * L'issue d'un bilan à un seul destinataire. Un message remis l'emporte ; un
 * refus de Discord (`failed`) dit un membre joint mais fermé ; un membre
 * introuvable (`unresolved`) dit un joueur absent du serveur. Un bilan vide ou
 * illisible ne dit rien : `null` (la route le rend en échec générique).
 */
export function dmTestOutcome(report: DmTestReport): DmTestOutcome | null {
  if (typeof report.sent === "number" && report.sent > 0) return "SENT";
  if (hasEntries(report.failed)) return "DMS_CLOSED";
  if (hasEntries(report.unresolved)) return "NOT_IN_SERVER";
  return null;
}

/** Le message de test : court, neutre, sans lien ni nom de personne. */
export const DM_TEST_MESSAGE: LocalizedDm = (locale) =>
  locale === "en"
    ? "BlueGenji test message: the bot can reach you by direct message. Nothing to do."
    : "Message de test BlueGenji : le bot peut te joindre en message privé. Rien à faire.";

/** Clé de texte (`profile.dmTest.*`) d'une notification. */
export type DmTestToastKey =
  | "sent"
  | "dmsClosed"
  | "notInServer"
  | "notLinked"
  | "botUnreachable"
  | "tooMany"
  | "failed";

/** Ton et texte de la notification. */
export type DmTestToast = { tone: "success" | "error"; key: DmTestToastKey };

/** La notification d'une issue rendue par la route. */
export function dmTestOutcomeToast(outcome: unknown): DmTestToast {
  switch (outcome) {
    case "SENT":
      return { tone: "success", key: "sent" };
    case "DMS_CLOSED":
      return { tone: "error", key: "dmsClosed" };
    case "NOT_IN_SERVER":
      return { tone: "error", key: "notInServer" };
    default:
      return { tone: "error", key: "failed" };
  }
}

/**
 * La notification d'un code de refus. `DISCORD_NOT_CERTIFIED` n'en a pas :
 * l'écran ouvre à la place la fenêtre qui propose de certifier (`null`).
 */
export function dmTestErrorToast(code: unknown): DmTestToast | null {
  switch (code) {
    case DM_TEST_NOT_CERTIFIED:
      return null;
    case DM_TEST_NOT_LINKED:
      return { tone: "error", key: "notLinked" };
    case DM_TEST_BOT_UNREACHABLE:
    case DM_TEST_BUSY:
      return { tone: "error", key: "botUnreachable" };
    case "TOO_MANY_REQUESTS":
      return { tone: "error", key: "tooMany" };
    default:
      return { tone: "error", key: "failed" };
  }
}
