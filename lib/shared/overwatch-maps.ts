/**
 * Cartes d'Overwatch proposées par la fenêtre « Cartes et bans »
 * (`docs/features/ROUND_MAPS.md`), rangées par mode de jeu.
 *
 * Les noms sont ceux du jeu en anglais, tels qu'ils sont stockés : un réglage
 * reste une liste de noms, et une carte absente d'ici se saisit toujours à la
 * main. Le même nom sert en français : la graphie française officielle n'a pas
 * pu être vérifiée carte par carte (décision consignée), et l'arbitrage comme
 * les joueurs connaissent ces noms.
 *
 * Marvel Rivals n'a pas de liste : saisie libre seulement.
 */

/** Modes de jeu des cartes, dans l'ordre d'affichage. */
export const OVERWATCH_MAP_MODES = ["CONTROL", "ESCORT", "HYBRID", "PUSH", "FLASHPOINT", "CLASH"] as const;

export type OverwatchMapMode = (typeof OVERWATCH_MAP_MODES)[number];

/** Cartes jouables en partie personnalisée, par mode. */
export const OVERWATCH_MAPS: Readonly<Record<OverwatchMapMode, readonly string[]>> = {
  CONTROL: ["Antarctic Peninsula", "Busan", "Ilios", "Lijiang Tower", "Nepal", "Oasis", "Samoa"],
  ESCORT: [
    "Circuit Royal",
    "Dorado",
    "Havana",
    "Junkertown",
    "Rialto",
    "Route 66",
    "Shambali Monastery",
    "Watchpoint: Gibraltar",
    "Watchpoint: Grímsvötn",
  ],
  HYBRID: ["Blizzard World", "Eichenwalde", "Hollywood", "King's Row", "Midtown", "Numbani", "Paraíso"],
  PUSH: ["Colosseo", "Esperança", "New Queen Street", "Runasapi"],
  FLASHPOINT: ["Aatlis", "New Junk City", "Suravasa"],
  CLASH: ["Hanaoka", "Throne of Anubis"],
};

/** Clé de comparaison d'un nom : sans casse ni accents (« paraiso » trouve « Paraíso »). */
export function mapSearchKey(name: string): string {
  return name
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en");
}

/**
 * Cartes de la liste qui contiennent la recherche, mode par mode ; un mode sans
 * résultat est écarté. Recherche vide : toute la liste.
 */
export function filterOverwatchMaps(query: string): { mode: OverwatchMapMode; maps: string[] }[] {
  const needle = mapSearchKey(query.trim());
  return OVERWATCH_MAP_MODES.map((mode) => ({
    mode,
    maps: OVERWATCH_MAPS[mode].filter((map) => needle === "" || mapSearchKey(map).includes(needle)),
  })).filter((group) => group.maps.length > 0);
}

/** La carte fait-elle partie de la liste (comparée sans casse ni accents) ? */
export function isOverwatchMap(name: string): boolean {
  const key = mapSearchKey(name);
  return OVERWATCH_MAP_MODES.some((mode) => OVERWATCH_MAPS[mode].some((map) => mapSearchKey(map) === key));
}
