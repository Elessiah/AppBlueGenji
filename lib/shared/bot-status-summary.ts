import type { BotStatus } from "@/lib/shared/types";
import { botPayloadNumber } from "@/lib/shared/bot-payload";

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
 * La durée de fonctionnement affichée par la case « Uptime » — ou `null`.
 *
 * Elle vivait **entièrement** dans le `useEffect` de `BotStatusStrip`, donc
 * hors de portée des seuls tests qui l'entouraient : `renderToStaticMarkup`
 * n'exécute aucun effet, si bien que le cas « horodatages absents » n'
 * observait jamais que l'état initial de la case. La remise au tiret, la borne
 * à zéro et le premier affichage immédiat pouvaient tous être retirés sans
 * qu'une assertion bronche — une couverture qui ne couvre rien est pire que
 * pas de couverture, parce qu'elle se lit comme une garantie.
 *
 * Trois choses qu'elle tient, et que le composant ne décide plus :
 *
 * 1. **`null` plutôt que « NaNj NaNh NaNm ».** Les deux horodatages arrivent
 *    par un `as BotStatus` sur du JSON reçu ; sans eux, le calcul ne rend pas
 *    une erreur mais une panne muette. Et il faut **reposer** le tiret : sortir
 *    sans rien écrire laissait la case sur la durée de la charge précédente,
 *    donc « 1j 04h 23m » juste à côté de « Le bot n'a pas répondu à la page ».
 * 2. **Bornée à zéro.** L'horloge du visiteur et celle du bot n'ont aucune
 *    raison de concorder, et une dérive de quelques secondes rendait
 *    « -1j 23h 59m ».
 * 3. **`now` est un argument.** C'est ce qui rend la fonction pure, donc
 *    testable sans horloge truquée — et le composant se contente de lui passer
 *    `Date.now()` à chaque seconde.
 *
 * **Ce que le calcul est vraiment, et ce qu'il n'est pas.** La forme héritée
 * s'écrivait `uptimeMs/1000 + (now − startupTs − uptimeMs)/1000`, comme si elle
 * partait de la durée annoncée puis y ajoutait le temps écoulé depuis. Elle ne
 * le fait pas : `uptimeMs` s'y **annule**, et il ne reste que `now − startupTs`.
 * Deux conséquences qu'il vaut mieux lire ici que déduire d'une soustraction :
 *
 * - la durée est mesurée **entre deux horloges** — celle du bot pour
 *   `startupTs`, celle du visiteur pour `now` —, d'où la borne à zéro du
 *   point 2, qui est le seul remède possible tant que la charge ne porte pas
 *   l'instant de sa propre fabrication ;
 * - `uptimeMs` ne pèse que sur la **présence** : une charge qui l'omet rend
 *   « — » bien que la durée soit calculable. C'est délibéré — une charge à
 *   laquelle il manque un champ du type est une charge qu'on ne sait pas lire,
 *   et le panneau dit « je ne sais pas » plutôt que d'afficher un chiffre tiré
 *   de la moitié qui reste.
 *
 * L'expression est donc écrite sous sa forme réduite, et un test la fige :
 * la réécrire « pour repartir de `uptimeMs` » ne changerait rien au résultat et
 * remettrait la même illusion.
 */
export function botUptimeLabel(status: BotStatus | null | undefined, now: number): string | null {
  const base = botPayloadNumber(status?.startupTs);
  const uptimeMs = botPayloadNumber(status?.uptimeMs);
  if (base === null || uptimeMs === null) return null;

  const elapsed = Math.max(0, Math.floor((now - base) / 1000));
  const d = Math.floor(elapsed / 86400);
  const h = Math.floor((elapsed % 86400) / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${d}j ${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}
