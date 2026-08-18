/**
 * Format de match d'un tournoi : « BO5 » (Best of 5) ou « FT3 » (First to 3).
 *
 * Les deux notations décrivent la même course — la première équipe à N manches
 * gagnées remporte le match — mais ne la nomment pas de la même façon :
 *
 * - `BO` compte le **nombre maximal de manches jouées** (impair, pour qu'il n'y
 *   ait pas d'égalité possible) : un BO5 se joue en 5 manches au plus et se
 *   gagne à 3.
 * - `FT` compte directement l'**objectif** : un FT3 se gagne à 3, ce qui plafonne
 *   la rencontre à 5 manches.
 *
 * Tout le reste du code ne manipule donc que deux grandeurs dérivées :
 * `matchWinsRequired` (le score du vainqueur) et `matchMaxMaps` (la somme des
 * deux scores au maximum). Un tournoi sans format défini (`null`) reste en
 * saisie libre : c'est le comportement historique, et celui des tournois créés
 * avant cette fonctionnalité.
 *
 * Module pur : importable côté serveur comme côté client.
 */

export type MatchFormatType = "BO" | "FT";

export interface MatchFormat {
  type: MatchFormatType;
  /** Nombre de manches : total maximal en `BO`, objectif en `FT`. */
  value: number;
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
 */
export function parseMatchFormat(type: unknown, value: unknown): MatchFormat | null {
  if (type === null || type === undefined || value === null || value === undefined) return null;
  if (!isValidMatchFormat(type, value)) return null;
  return { type: type as MatchFormatType, value: Number(value) };
}

/** Score qu'atteint le vainqueur : ⌈N/2⌉ en `BO`, N en `FT`. */
export function matchWinsRequired(format: MatchFormat): number {
  return format.type === "FT" ? format.value : Math.ceil(format.value / 2);
}

/** Nombre maximal de manches jouées, donc plafond de la somme des deux scores. */
export function matchMaxMaps(format: MatchFormat): number {
  return matchWinsRequired(format) * 2 - 1;
}

/** Étiquette courte, telle qu'affichée sur les pastilles : « BO5 », « FT3 ». */
export function matchFormatLabel(format: MatchFormat | null): string {
  return format ? `${format.type}${format.value}` : "Score libre";
}

/**
 * Phrase d'aide affichée à côté des champs de score. Elle ne répète pas la
 * notation — les appelants la préfixent de `matchFormatLabel` — et dit la même
 * chose pour un BO5 et un FT3, qui décrivent la même course.
 */
export function matchFormatDescription(format: MatchFormat | null): string {
  if (!format) return "Aucune limite de score.";

  const wins = matchWinsRequired(format);

  return `premier à ${wins} manche${wins > 1 ? "s" : ""} gagnée${wins > 1 ? "s" : ""}, ${matchMaxMaps(format)} au maximum.`;
}

export type MatchScoreViolation = "SCORE_EXCEEDS_MATCH_FORMAT" | "SCORE_BELOW_MATCH_FORMAT";

/**
 * Contrôle une paire de scores contre le format du tournoi.
 *
 * `decisive` distingue les deux usages : un score qui **désigne un vainqueur**
 * (report d'équipe, résolution par l'arbitrage) doit voir le gagnant atteindre
 * exactement l'objectif, alors qu'une sauvegarde intermédiaire — l'arbitrage
 * note 1-0 pendant que le match se joue — n'a qu'à respecter le plafond.
 *
 * Renvoie `null` quand tout est bon, ou le code d'erreur à remonter.
 */
export function checkMatchScores(
  format: MatchFormat | null,
  team1Score: number,
  team2Score: number,
  options: { decisive: boolean },
): MatchScoreViolation | null {
  if (!format) return null;

  const wins = matchWinsRequired(format);

  // Un score au-dessus de l'objectif, ou une somme au-dessus du nombre de
  // manches jouables (3-3 en BO5 : les deux équipes ne peuvent pas gagner).
  if (team1Score > wins || team2Score > wins) return "SCORE_EXCEEDS_MATCH_FORMAT";
  if (team1Score + team2Score > matchMaxMaps(format)) return "SCORE_EXCEEDS_MATCH_FORMAT";

  if (options.decisive && Math.max(team1Score, team2Score) !== wins) {
    return "SCORE_BELOW_MATCH_FORMAT";
  }

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
  if (!format) return "Score invalide.";

  const wins = matchWinsRequired(format);
  const label = matchFormatLabel(format);

  return violation === "SCORE_EXCEEDS_MATCH_FORMAT"
    ? `Score impossible en ${label} : ${matchMaxMaps(format)} manches au maximum, et jamais plus de ${wins} par équipe.`
    : `Score incomplet en ${label} : le vainqueur doit atteindre ${wins} manche${wins > 1 ? "s" : ""}.`;
}
