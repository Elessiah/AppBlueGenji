import type { BotStatus } from "@/lib/shared/types";

/**
 * Le sous-titre de la case « Status » de `/bot` — **il dit l'état affiché
 * juste au-dessus**.
 *
 * La case annonçait une phrase fixe (des « modules nominaux ») quel que soit
 * l'état, et alors que plus rien sur la page ne parle de modules depuis que la
 * grille qui les montrait a été retirée. Une phrase fixe sous une valeur qui
 * varie finit par la contredire : elle disait « nominaux » sous un `DOWN`.
 *
 * La règle vit ici, pure, pour la même raison que `bot-relay-status.ts` : elle
 * se teste sans rendu, et surtout elle **nomme l'état qu'elle ne connaît pas**.
 * `fetchBotStatus` fait un simple `as BotStatus` sur du JSON reçu par le
 * réseau ; une recherche directe dans un `Record` rendrait `undefined` au
 * premier état ajouté côté bot (ou à la première minuscule), React
 * n'afficherait rien, et la ligne serait vide sans qu'aucune erreur ne le
 * signale — la panne muette que cette page vient de chasser.
 */
export type BotStatusLabel = BotStatus["status"] | "UNREACHABLE" | "UNREADABLE";

/**
 * **Deux silences, pas un.** « Le bot n'a rien dit » et « le bot a dit quelque
 * chose que la page ne sait pas lire » sont deux faits distincts, et les
 * confondre refabrique le défaut qu'on vient de retirer : la case afficherait
 * `MAINTENANCE` en gros avec « le bot n'a pas répondu » juste en dessous.
 */
const STATUS_SUMMARIES: Record<BotStatusLabel, string> = {
  OPERATIONAL: "Tous les services répondent",
  DEGRADED: "Service dégradé — certaines réponses tardent",
  DOWN: "Le bot ne répond plus",
  UNREACHABLE: "Le bot n'a pas répondu à la page",
  UNREADABLE: "Le bot a répondu un état que la page ne sait pas lire",
};

const KNOWN_STATUSES: Record<BotStatus["status"], true> = {
  OPERATIONAL: true,
  DEGRADED: true,
  DOWN: true,
};

/** L'état reçu, ramené à l'une des valeurs que la page sait nommer. */
export function resolveBotStatusLabel(status: string | null | undefined): BotStatusLabel {
  if (!status) return "UNREACHABLE";
  if (!Object.prototype.hasOwnProperty.call(KNOWN_STATUSES, status)) {
    return "UNREADABLE";
  }
  return status as BotStatusLabel;
}

/** Ce que la case affiche en gros : la valeur reçue, ou un tiret. */
export function botStatusDisplay(status: string | null | undefined): string {
  if (!status) return "—";
  // Un état inconnu se montre **tel quel** : c'est une information pour qui
  // lit la page, et la ligne du dessous dira qu'on ne sait pas le lire.
  return status;
}

/** Le sous-titre, jamais vide. */
export function botStatusSummary(status: string | null | undefined): string {
  return STATUS_SUMMARIES[resolveBotStatusLabel(status)];
}
