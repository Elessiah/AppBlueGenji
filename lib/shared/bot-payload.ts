/**
 * Lire un champ d'une charge venue du bot — **sans jamais la croire sur parole**.
 *
 * `lib/server/bot-integration.ts` rend chacune de ses charges par un simple
 * `as` sur du JSON reçu par le réseau (`as BotStatus`, `as BotServersPayload`,
 * …). Le type n'est donc pas une garantie mais une **intention** : à
 * l'exécution, n'importe quel champ peut manquer, arriver dans un autre type,
 * ou valoir `NaN`. Et comme `/bot` est rendue par des composants serveur, la
 * moindre exception pendant le rendu ne fait pas une case vide : elle sert la
 * page entière en 500.
 *
 * Les trois fonctions ci-dessous sont ce **seul** garde-fou, partagé par les
 * deux charges. Elles vivent dans leur propre module plutôt que chez l'une
 * d'elles : la bande d'état et le tableau des serveurs ne décrivent pas le même
 * objet, et loger la règle chez l'un aurait fait dépendre l'autre d'un module
 * dont il n'affiche rien — une retouche du résumé d'état aurait alors changé le
 * rendu d'un compte de membres.
 *
 * Elles rendent toutes `null` plutôt qu'une valeur de repli : c'est à
 * l'appelant de décider ce que « pas de valeur » affiche, un tiret n'ayant pas
 * le même sens dans une case de version et dans une barre de progression.
 */

/**
 * Un champ **numérique**, ou `null`.
 *
 * `NaN` est écarté au même titre qu'une chaîne : il ne lève pas, il se
 * **propage** — un `Math.max` empoisonné, puis des `width: NaN%` que le
 * navigateur laisse tomber en silence. C'est la panne muette, pas l'erreur.
 */
export function botPayloadNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Un champ ramené à du texte affichable, ou `null` — jamais une chaîne vide. */
export function botPayloadText(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  const numeric = botPayloadNumber(value);
  return numeric === null ? null : String(numeric);
}

/**
 * Un champ posé **tel quel dans du JSX**, ramené à une chaîne.
 *
 * C'est le cas qui ne pardonne pas : un objet ou un tableau passé en enfant de
 * React lève « Objects are not valid as a React child » pendant le rendu, donc
 * toute la page en 500 — là où un nombre mal typé se contentait de mal
 * s'afficher. D'où un repli sur la **chaîne vide** et non sur `null` : ce qu'on
 * veut ici est qu'il ne reste rien à rendre, pas une décision de plus.
 */
export function botPayloadLabel(value: unknown): string {
  return botPayloadText(value) ?? "";
}

/** Les seules écritures de couleur que le site accepte d'une charge du bot. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Une couleur d'accent, ou `null`.
 *
 * Prouver qu'une valeur est une **chaîne** ne prouve pas qu'elle est une
 * couleur : `accentColor: "blurple"` traverse `botPayloadText`, puis rend
 * `color-mix(in oklab, blurple …)` invalide au calcul — et une déclaration
 * invalide n'est pas remplacée, elle est **abandonnée**. Le sigil perdait alors
 * fond, bordure et couleur de texte d'un coup, sans une erreur. Le repli
 * `var(--c, var(--blue-500))` du CSS ne couvre pas ce cas : il ne joue que si
 * la propriété est **absente**, ce que `null` obtient ici et qu'une valeur
 * invalide n'obtient pas.
 */
export function botPayloadColor(value: unknown): string | null {
  const text = botPayloadText(value);
  return text !== null && HEX_COLOR.test(text) ? text : null;
}
