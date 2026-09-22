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

/**
 * L'état lu sur la charge du bot — **`null` veut dire « aucune réponse », et
 * rien d'autre**.
 *
 * C'est ici que les deux silences se séparent, parce que c'est le seul endroit
 * qui voie la différence : une fois l'état extrait, `undefined` (le champ
 * manque) et `null` (il n'y a pas eu de réponse) sont la même valeur. Or
 * `fetchBotStatus` rend la charge par un simple `as BotStatus` : une réponse
 * sans champ `status` est parfaitement possible, et elle donnait
 * « Le bot n'a pas répondu à la page » **à côté** d'un uptime, d'une version et
 * d'une latence tirés de cette réponse-là — la phrase fixe qui contredit la
 * valeur d'à côté, c'est-à-dire le défaut que ce module retire.
 *
 * Toute réponse reçue rend donc une chaîne, fût-elle vide.
 */
export function botStatusOf(status: BotStatus | null | undefined): string | null {
  if (!status) return null;
  const raw: unknown = status.status;
  return typeof raw === "string" ? raw : "";
}

/** L'état reçu, ramené à l'une des valeurs que la page sait nommer. */
export function resolveBotStatusLabel(status: string | null | undefined): BotStatusLabel {
  // `== null` et non `!status` : la chaîne vide est une **réponse** reçue dont
  // l'état est illisible, pas une absence de réponse.
  if (status == null) return "UNREACHABLE";
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

/**
 * Un champ **numérique** de la charge du bot, ou `null`.
 *
 * Même prémisse que `botStatusOf` : `fetchBotStatus` rend la charge par un
 * simple `as BotStatus` sur du JSON reçu, si bien qu'aucun champ n'est garanti
 * malgré le type. Un `?? 0` ne rattrape que `null` et `undefined` — un
 * `cpuUsage: "12%"` le traverse, et le `.toFixed()` qui suit lève **pendant le
 * rendu** : la page `/bot` entière part alors en 500, ce qui est bien pire que
 * la case fade qu'on met à la place. Un `NaN` est écarté pour la même raison :
 * il ne lève pas, il se propage, et finit en `width: NaN%` — la panne muette.
 */
export function botStatusNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Un champ de la charge du bot, ramené à du texte affichable, ou `null`. */
export function botStatusText(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  const numeric = botStatusNumber(value);
  return numeric === null ? null : String(numeric);
}
