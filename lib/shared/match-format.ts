/**
 * Format de match d'un tournoi : « BO5 » (Best of 5) ou « FT3 » (First to 3).
 *
 * Les deux notations décrivent la **même course** — la première équipe à N
 * manches gagnées remporte le match — mais ne la nomment pas de la même façon :
 *
 * - `BO` compte le **nombre maximal de manches jouées** : un BO5 se joue en 5
 *   manches au plus et se gagne à 3.
 * - `FT` compte directement l'**objectif** : un FT3 se gagne à 3, ce qui plafonne
 *   la rencontre à 5 manches.
 *
 * Tout le reste du code ne manipule donc que deux grandeurs dérivées :
 * `matchWinsRequired` (le score du vainqueur) et `matchMaxMaps` (la somme des
 * deux scores au maximum). Un tournoi sans format défini (`null`) reste en
 * saisie libre : c'est le comportement historique, et celui des tournois créés
 * avant cette fonctionnalité.
 *
 * ## Deux réglages qui séparent enfin BO et FT
 *
 * Longtemps, « BO5 » et « FT3 » ont désigné **le même objet** ici : le plafond
 * de maps valait toujours `objectif × 2 − 1`, et un vainqueur était toujours
 * exigé. Overwatch et Marvel Rivals connaissent pourtant la **map nulle**, si
 * bien qu'un BO5 peut s'arrêter sur 2-2 sans que personne n'atteigne 3. Deux
 * réglages facultatifs le rendent exprimable, et ne changent **rien** aux
 * tournois qui ne les posent pas :
 *
 * - {@link MatchFormat.maxMaps} — plafond de maps **décisives** (voir plus bas),
 *   réglable en deçà de son plafond naturel.
 * - {@link MatchFormat.drawsAllowed} — le match se clôt sur n'importe quel score
 *   tenant dans le plafond, vainqueur ou non : 2-1 en FT3 comme 2-2.
 *
 * **Ce que plafonne `maxMaps`.** La somme des deux scores, c'est-à-dire les maps
 * qui ont **désigné un vainqueur**. Une map nulle ne figure dans aucun des deux
 * scores — les colonnes de `bg_matches` n'en gardent pas trace — elle allonge
 * donc la rencontre sans consommer le plafond. « 5 maps » veut dire ici « au
 * plus 5 maps décisives », pas « exactement 5 maps jouées » : c'est la seule
 * lecture que les données permettent de tenir.
 *
 * Module pur : importable côté serveur comme côté client.
 */

export type MatchFormatType = "BO" | "FT";

export interface MatchFormat {
  type: MatchFormatType;
  /** Nombre de manches : total maximal en `BO`, objectif en `FT`. */
  value: number;
  /**
   * Plafond de maps **décisives** (somme des deux scores).
   *
   * `null` / absent = le plafond naturel du format ({@link naturalMaxMaps}),
   * seule valeur qu'aient connue les tournois d'avant ce réglage. Le poser plus
   * bas ouvre une fenêtre d'égalité : un FT3 plafonné à 4 maps s'arrête sur 2-2.
   */
  maxMaps?: number | null;
  /**
   * Le match peut-il se clore sans que l'objectif soit atteint ?
   *
   * Quand c'est vrai, **n'importe quel** score tenant dans le plafond est un
   * résultat final : 2-1 en FT3 (une map nulle a consommé la cinquième), 2-2,
   * et jusqu'à 0-0. Le match n'a alors pas forcément de vainqueur —
   * `winner_team_id` reste `NULL`.
   *
   * Réservé aux formats qui savent absorber un match nul : la phase
   * qualificative de « BlueGenji Survie », dont le capital se compte map par
   * map. Un arbre à élimination directe a besoin d'un vainqueur pour poser le
   * tour suivant : les play-offs y ont leur propre format, sans égalité.
   */
  drawsAllowed?: boolean;
}

/** Bornes de saisie, partagées par le formulaire et le garde-fou serveur. */
export const MATCH_FORMAT_BOUNDS: Record<MatchFormatType, { min: number; max: number }> = {
  BO: { min: 1, max: 15 },
  FT: { min: 1, max: 10 },
};

/** Format proposé par défaut à la création d'un tournoi. */
export const DEFAULT_MATCH_FORMAT: MatchFormat = { type: "BO", value: 5 };

export function isMatchFormatType(value: unknown): value is MatchFormatType {
  return value === "BO" || value === "FT";
}

/** Score qu'atteint le vainqueur : ⌈N/2⌉ en `BO`, N en `FT`. */
export function matchWinsRequired(format: MatchFormat): number {
  return format.type === "FT" ? format.value : Math.ceil(format.value / 2);
}

/**
 * Plafond **naturel** de maps décisives : celui qu'impose la course elle-même.
 *
 * À `objectif × 2 − 1`, une map de plus est impossible — l'une des deux équipes
 * a forcément atteint l'objectif avant. C'est le plafond de tout format qui n'en
 * fixe pas un autre, et la borne haute de {@link MatchFormat.maxMaps}.
 */
export function naturalMaxMaps(format: MatchFormat): number {
  return matchWinsRequired(format) * 2 - 1;
}

/**
 * Nombre maximal de maps décisives, donc plafond de la somme des deux scores.
 *
 * Un plafond posé hors bornes est ramené dans l'intervalle plutôt que refusé :
 * la fonction est lue partout, y compris sur des lignes de base écrites avant
 * une règle de validation, et un plafond absurde ne doit pas rendre un tournoi
 * injouable.
 */
export function matchMaxMaps(format: MatchFormat): number {
  const natural = naturalMaxMaps(format);

  // `null` est « pas de plafond », pas « zéro » : sans ce test, `Number(null)`
  // vaut 0, passe pour un entier et ramenait le plafond à l'objectif — un FT3
  // se serait arrêté à trois maps décisives. Le cas n'était pas théorique : le
  // repli de l'arbre final (`withoutDraws`) écrit précisément `maxMaps: null`.
  if (format.maxMaps === null || format.maxMaps === undefined) return natural;

  const raw = Number(format.maxMaps);
  if (!Number.isInteger(raw)) return natural;

  return Math.min(natural, Math.max(matchWinsRequired(format), raw));
}

/** Le format tolère-t-il un match sans vainqueur ? (`null` = non : score libre) */
export function matchAllowsDraw(format: MatchFormat | null | undefined): boolean {
  return format?.drawsAllowed === true;
}

/**
 * Valide un plafond de maps pour un format donné.
 *
 * Il doit rester entre l'objectif (sans quoi personne ne peut l'atteindre, et
 * le match n'aurait jamais de vainqueur) et le plafond naturel (au-delà, la
 * valeur ne décrit plus rien : la course est déjà finie).
 */
export function isValidMatchMaxMaps(format: MatchFormat, maxMaps: unknown): boolean {
  if (maxMaps === null || maxMaps === undefined) return true;
  if (typeof maxMaps !== "number" && typeof maxMaps !== "string") return false;
  if (typeof maxMaps === "string" && maxMaps.trim() === "") return false;

  const parsed = Number(maxMaps);
  if (!Number.isInteger(parsed)) return false;

  return parsed >= matchWinsRequired(format) && parsed <= naturalMaxMaps(format);
}

/**
 * Valide un couple (type, nombre de manches). Un `BO` pair est refusé : « best
 * of 4 » n'a pas de sens, la rencontre pourrait finir 2-2 sans vainqueur.
 */
export function isValidMatchFormat(type: unknown, value: unknown): boolean {
  if (!isMatchFormatType(type)) return false;

  // Coercer d'abord laisserait passer `true` (→ 1) ou `[3]` (→ 3) : on n'accepte
  // qu'un nombre, ou la chaîne que renvoie la colonne d'une base.
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return false;

  const bounds = MATCH_FORMAT_BOUNDS[type];
  if (parsed < bounds.min || parsed > bounds.max) return false;
  if (type === "BO" && parsed % 2 === 0) return false;

  return true;
}

/**
 * Lit un format depuis une source non fiable (corps HTTP, colonnes de base).
 * Renvoie `null` — saisie libre — dès qu'une des deux valeurs manque ou est
 * incohérente, plutôt que de laisser passer une contrainte à moitié définie.
 *
 * Les deux réglages facultatifs suivent la même logique de tolérance : un
 * plafond illisible retombe sur le plafond naturel, et les égalités ne sont
 * ouvertes que sur un `true` franc — jamais sur une valeur ambiguë.
 */
export function parseMatchFormat(
  type: unknown,
  value: unknown,
  maxMaps?: unknown,
  drawsAllowed?: unknown,
): MatchFormat | null {
  if (type === null || type === undefined || value === null || value === undefined) return null;
  if (!isValidMatchFormat(type, value)) return null;

  const format: MatchFormat = { type: type as MatchFormatType, value: Number(value) };

  if (maxMaps !== null && maxMaps !== undefined && isValidMatchMaxMaps(format, maxMaps)) {
    format.maxMaps = Number(maxMaps);
  }
  if (drawsAllowed === true || drawsAllowed === 1 || drawsAllowed === "1") {
    format.drawsAllowed = true;
  }

  return format;
}

/**
 * Manches portées au vainqueur d'un **forfait**, l'autre équipe restant à zéro.
 *
 * Un forfait n'est pas une rencontre blanche : le règlement le compte comme le
 * score plein du format du tournoi — un FT3 se solde donc par un 3-0, avec tout
 * ce que cela emporte (barème d'endurance, bilan de maps des fiches). Sans
 * format — tournoi en saisie libre — il vaut 1-0 : le plus petit score qui
 * désigne encore un vainqueur, car un 0-0 n'en désignerait aucun.
 *
 * C'est la seule définition du chiffre : `adminResolveMatch` l'écrit en base,
 * le rejeu d'endurance et le bilan de maps le relisent depuis le format pour
 * les forfaits enregistrés avant cette règle, sans score en colonnes.
 */
export function forfeitMapCount(format: MatchFormat | null | undefined): number {
  return format ? matchWinsRequired(format) : 1;
}

/**
 * Étiquette courte, telle qu'affichée sur les pastilles : « BO5 », « FT3 ».
 *
 * Un plafond de maps réglé sous son plafond naturel est ajouté — sans lui,
 * « FT3 » se lirait comme un FT3 ordinaire alors que la rencontre s'arrête une
 * map plus tôt, et que l'égalité y est possible.
 */
export function matchFormatLabel(format: MatchFormat | null): string {
  if (!format) return "Score libre";

  const base = `${format.type}${format.value}`;
  const maps = matchMaxMaps(format);

  return maps === naturalMaxMaps(format) ? base : `${base} · ${maps} maps`;
}

/**
 * Phrase d'aide affichée à côté des champs de score. Elle ne répète pas la
 * notation — les appelants la préfixent de `matchFormatLabel` — et dit la même
 * chose pour un BO5 et un FT3, qui décrivent la même course.
 */
export function matchFormatDescription(format: MatchFormat | null): string {
  if (!format) return "Aucune limite de score.";

  const wins = matchWinsRequired(format);
  const plural = wins > 1 ? "s" : "";
  const course = `premier à ${wins} manche${plural} gagnée${plural}, ${matchMaxMaps(format)} au maximum.`;

  return matchAllowsDraw(format)
    ? `${course} Le match peut se clore sans vainqueur (map nulle).`
    : course;
}

/**
 * Quel side remporte la rencontre — `1`, `2`, ou `null` pour un match nul.
 *
 * **Une seule implémentation**, partagée par les trois chemins qui tranchent un
 * match : l'arbitrage, l'accord des deux engagés, et l'expiration du délai de
 * report. Ils dérivaient chacun leur vainqueur, avec deux règles différentes
 * pour l'égalité (`>` d'un côté, `>=` de l'autre) — sans conséquence tant
 * qu'aucun score nul ne pouvait être enregistré.
 *
 * Sur un format qui n'autorise pas l'égalité, un score nul rend `1` plutôt que
 * `null` : ce n'est pas une règle, c'est un filet. La validation le refuse en
 * amont ({@link checkMatchScores}), mais une ligne écrite avant cette règle ne
 * doit pas laisser un plateau sans qualifiée.
 */
export function matchWinnerSide(
  format: MatchFormat | null,
  team1Score: number,
  team2Score: number,
): 1 | 2 | null {
  if (team1Score === team2Score) return matchAllowsDraw(format) ? null : 1;
  return team1Score > team2Score ? 1 : 2;
}

/**
 * Le même format, égalités fermées.
 *
 * Sert au repli de l'arbre final de « BlueGenji Survie » : faute de format de
 * play-offs propre, il joue celui du tournoi — mais **jamais** ses égalités, un
 * match sans vainqueur ne désignant personne pour le tour suivant. Le plafond
 * de maps, lui, est conservé : il décrit la rencontre, pas son issue.
 */
export function withoutDraws(format: MatchFormat | null): MatchFormat | null {
  if (!format || !format.drawsAllowed) return format;

  return { type: format.type, value: format.value, maxMaps: format.maxMaps ?? null };
}

export type MatchScoreViolation =
  | "SCORE_EXCEEDS_MATCH_FORMAT"
  | "SCORE_BELOW_MATCH_FORMAT"
  | "DRAW_NOT_ALLOWED";

/**
 * Contrôle une paire de scores contre le format du tournoi.
 *
 * `decisive` distingue les deux usages : un score qui **clôt la rencontre**
 * (report d'équipe, résolution par l'arbitrage) doit constituer un résultat
 * final, alors qu'une sauvegarde intermédiaire — l'arbitrage note 1-0 pendant
 * que le match se joue — n'a qu'à respecter le plafond.
 *
 * Ce qu'est un « résultat final » dépend du format, et c'est tout l'objet de
 * {@link MatchFormat.drawsAllowed} : sans lui, le vainqueur doit atteindre
 * l'objectif et l'égalité est refusée ; avec lui, tout score tenant dans le
 * plafond convient, l'égalité comprise.
 *
 * **Unique implémentation** : l'interface s'en sert pour borner les champs et
 * activer « Valider le résultat », le serveur pour refuser en 400. Renvoie
 * `null` quand tout est bon, ou le code d'erreur à remonter.
 */
export function checkMatchScores(
  format: MatchFormat | null,
  team1Score: number,
  team2Score: number,
  options: { decisive: boolean },
): MatchScoreViolation | null {
  const drawn = team1Score === team2Score;

  // Sans format — saisie libre — le plafond ne dit rien, mais l'égalité reste
  // refusée : c'est le comportement des tournois d'avant cette règle, et un
  // arbre à élimination directe n'a rien à faire d'un match sans vainqueur.
  if (!format) {
    return options.decisive && drawn ? "DRAW_NOT_ALLOWED" : null;
  }

  const wins = matchWinsRequired(format);

  // Un score au-dessus de l'objectif, ou une somme au-dessus du nombre de
  // manches jouables (3-3 en BO5 : les deux équipes ne peuvent pas gagner).
  if (team1Score > wins || team2Score > wins) return "SCORE_EXCEEDS_MATCH_FORMAT";
  if (team1Score + team2Score > matchMaxMaps(format)) return "SCORE_EXCEEDS_MATCH_FORMAT";

  if (!options.decisive) return null;
  if (matchAllowsDraw(format)) return null;

  // Le contrôle de l'objectif suffit à refuser l'égalité, et le dit mieux :
  // une égalité **sous** l'objectif est d'abord un score incomplet (« le
  // vainqueur doit atteindre 3 manches »), et une égalité **à** l'objectif est
  // impossible — 3-3 en FT3 dépasse déjà le plafond, refusé plus haut. D'où
  // l'absence de branche `DRAW_NOT_ALLOWED` ici : elle ne serait jamais prise.
  if (Math.max(team1Score, team2Score) !== wins) return "SCORE_BELOW_MATCH_FORMAT";

  return null;
}

/**
 * Message d'erreur en clair pour une violation de format, avec les valeurs du
 * tournoi. Utilisé par l'interface avant l'envoi ; le serveur, lui, renvoie le
 * code brut (voir `_lib/error-map.ts` pour la formulation de repli).
 */
export function matchScoreViolationMessage(
  format: MatchFormat | null,
  violation: MatchScoreViolation,
): string {
  if (violation === "DRAW_NOT_ALLOWED") {
    return "Match nul impossible : ce tournoi exige un vainqueur.";
  }

  if (!format) return "Score invalide.";

  const wins = matchWinsRequired(format);
  const label = matchFormatLabel(format);

  return violation === "SCORE_EXCEEDS_MATCH_FORMAT"
    ? `Score impossible en ${label} : ${matchMaxMaps(format)} manches au maximum, et jamais plus de ${wins} par équipe.`
    : `Score incomplet en ${label} : le vainqueur doit atteindre ${wins} manche${wins > 1 ? "s" : ""}.`;
}
