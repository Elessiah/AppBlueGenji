/**
 * Détail map par map d'un match (`docs/features/MAP_SCORES.md`).
 *
 * Module **pur**, partagé par l'interface (saisie, aperçu du score dérivé) et
 * le serveur (refus en 400) : une seule implémentation des règles, comme
 * `checkMatchScores` dont il se sert.
 *
 * Le score d'un match se **dérive** de ses maps : une map gagnée vaut un point,
 * une map nulle n'en vaut à personne. Le reste du moteur ne voit que ce score
 * dérivé, écrit dans `bg_matches.team1_score` / `team2_score` comme avant — si
 * bien que le rejeu des classements, la cote et les fiches lisent un match à
 * maps exactement comme un match d'avant cette fonctionnalité.
 */

import { checkMatchScores, matchAllowsDraw, matchMaxMaps, matchWinsRequired } from "./match-format";
import type { MatchFormat, MatchScoreViolation } from "./match-format";
import type { TournamentGame } from "./types";

/** Une map telle qu'on la saisit — orientation du plateau (équipe 1, équipe 2). */
export interface MatchMapInput {
  replayCode: string;
  team1Score: number;
  team2Score: number;
}

/** Une map enregistrée, numérotée à partir de 1. */
export interface MatchMapResult extends MatchMapInput {
  mapNumber: number;
}

/** Plus haut score accepté sur une map (rounds, points de capture…). */
export const MAP_SCORE_MAX = 99;

/** Plafond de maps d'un tournoi en score libre, faute d'objectif à lire. */
export const FREE_FORMAT_MAP_LIMIT = 9;

/**
 * Maps nulles **rejouées** tolérées en plus du plafond, sur un format qui exige
 * un vainqueur : une map nulle n'y consomme aucune manche décisive (le plafond
 * de `matchMaxMaps` porte sur la somme des scores), il faut donc de la place
 * pour la rejouer. Deux, et non un nombre illimité : au-delà, c'est à
 * l'arbitrage de trancher (décision requise, `MAP_SCORES.md`).
 */
export const DRAWN_MAP_REPLAY_ALLOWANCE = 2;

/** Longueur maximale stockée d'un code de replay (`bg_match_maps.replay_code`). */
export const REPLAY_CODE_MAX_LENGTH = 32;

/** Codes de replay Overwatch : six caractères alphanumériques (« A1B2C3 »). */
const OVERWATCH_REPLAY_CODE = /^[A-Z0-9]{6}$/;

/**
 * Marvel Rivals n'a pas de format public documenté (l'identifiant de partie
 * est numérique, de longueur variable) : motif permissif, alphanumérique et
 * tirets, 4 à 32 caractères.
 */
const PERMISSIVE_REPLAY_CODE = /^[A-Z0-9-]{4,32}$/;

/** Forme canonique d'un code : sans espaces, en majuscules. */
export function normalizeReplayCode(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase() : "";
}

/** Le code respecte-t-il le format du jeu ? `game` inconnu → motif permissif. */
export function isValidReplayCode(code: string, game: TournamentGame | null | undefined): boolean {
  return (game === "OW" ? OVERWATCH_REPLAY_CODE : PERMISSIVE_REPLAY_CODE).test(code);
}

/** Aide affichée sous le champ du code, selon le jeu. */
export function replayCodeHint(game: TournamentGame | null | undefined): string {
  return game === "OW"
    ? "Code de replay Overwatch : 6 caractères (lettres et chiffres)."
    : "Code ou identifiant de la partie : 4 à 32 caractères (lettres, chiffres, tirets).";
}

/**
 * Nombre de lignes de maps qu'un match peut porter.
 *
 * - format qui tolère l'égalité : `matchMaxMaps` — sans tiebreaker, une map
 *   nulle **consomme** une map du BO (BO5 → 5 maps jouées au plus) ;
 * - format qui exige un vainqueur : `matchMaxMaps` + {@link DRAWN_MAP_REPLAY_ALLOWANCE}
 *   — la map nulle se rejoue ;
 * - score libre : {@link FREE_FORMAT_MAP_LIMIT}.
 */
export function mapListLimit(format: MatchFormat | null): number {
  if (!format) return FREE_FORMAT_MAP_LIMIT;
  const max = matchMaxMaps(format);
  return matchAllowsDraw(format) ? max : max + DRAWN_MAP_REPLAY_ALLOWANCE;
}

/** Vainqueur d'une map : `1`, `2`, ou `null` pour une map nulle. */
export function mapWinnerSide(map: Pick<MatchMapInput, "team1Score" | "team2Score">): 1 | 2 | null {
  // Un score encore vide ne désigne personne.
  if (!Number.isFinite(map.team1Score) || !Number.isFinite(map.team2Score)) return null;
  if (map.team1Score === map.team2Score) return null;
  return map.team1Score > map.team2Score ? 1 : 2;
}

/** Score du match dérivé de ses maps : une map gagnée = un point, une nulle = rien. */
export function deriveMatchScore(maps: ReadonlyArray<Pick<MatchMapInput, "team1Score" | "team2Score">>): {
  team1: number;
  team2: number;
  drawnMaps: number;
} {
  let team1 = 0;
  let team2 = 0;
  let drawnMaps = 0;
  for (const map of maps) {
    const side = mapWinnerSide(map);
    if (side === 1) team1 += 1;
    else if (side === 2) team2 += 1;
    else drawnMaps += 1;
  }
  return { team1, team2, drawnMaps };
}

/**
 * Plus aucune map ne peut suivre ? Un camp a atteint l'objectif, ou (format à
 * égalités) toutes les maps du BO sont jouées. En score libre, rien n'arrête la
 * liste avant son plafond. Sert uniquement à la saisie (ajout de ligne, map
 * superflue) : ce qu'est un résultat final reste l'affaire de
 * `checkMatchScores`, inchangé.
 */
/** Match sans vainqueur clos avant d'avoir joué toutes ses maps (égalités ouvertes). */
function unplayedMapsViolation(
  format: MatchFormat | null,
  team1: number,
  team2: number,
  played: number,
  decisive: boolean,
): "MAP_LIST_INCOMPLETE" | null {
  if (!decisive || !format || !matchAllowsDraw(format)) return null;
  const short = Math.max(team1, team2) < matchWinsRequired(format) && played < matchMaxMaps(format);
  return short ? "MAP_LIST_INCOMPLETE" : null;
}

function isSettled(format: MatchFormat | null, team1: number, team2: number, played: number): boolean {
  if (!format) return false;
  if (Math.max(team1, team2) >= matchWinsRequired(format)) return true;
  return matchAllowsDraw(format) && played >= matchMaxMaps(format);
}

export type MapField = "replayCode" | "team1Score" | "team2Score";

export type MapListViolation =
  | "MAP_LIST_EMPTY"
  | "MAP_COUNT_EXCEEDED"
  | "MAP_REPLAY_CODE_REQUIRED"
  | "MAP_REPLAY_CODE_INVALID"
  | "MAP_REPLAY_CODE_DUPLICATE"
  | "MAP_SCORE_INVALID"
  | "MAP_AFTER_DECISION"
  | "MAP_LIST_INCOMPLETE"
  | MatchScoreViolation;

export interface MapListCheck {
  /** Premier refus rencontré, `null` si la liste est valable. */
  error: MapListViolation | null;
  /** Champ fautif (map numérotée à partir de 0), quand le refus en désigne un. */
  field: { index: number; field: MapField } | null;
  /** Score dérivé des maps (même invalides : sert à l'aperçu). */
  score: { team1: number; team2: number; drawnMaps: number };
}

/** Contrôle d'une ligne seule : code (présent, au motif, unique) puis scores. */
function checkMapEntry(
  map: MatchMapInput,
  game: TournamentGame | null | undefined,
  seen: Set<string>,
): { error: MapListViolation; field: MapField } | null {
  const code = normalizeReplayCode(map.replayCode);
  if (code === "") return { error: "MAP_REPLAY_CODE_REQUIRED", field: "replayCode" };
  if (!isValidReplayCode(code, game)) return { error: "MAP_REPLAY_CODE_INVALID", field: "replayCode" };
  if (seen.has(code)) return { error: "MAP_REPLAY_CODE_DUPLICATE", field: "replayCode" };
  seen.add(code);
  if (!isValidMapScore(map.team1Score)) return { error: "MAP_SCORE_INVALID", field: "team1Score" };
  if (!isValidMapScore(map.team2Score)) return { error: "MAP_SCORE_INVALID", field: "team2Score" };
  return null;
}

function isValidMapScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAP_SCORE_MAX;
}

/**
 * Contrôle une liste de maps contre le format du match et le jeu du tournoi.
 *
 * Les règles propres aux maps (code, score de map, plafond de lignes, map après
 * la fin) s'ajoutent ; le **score dérivé** passe ensuite par
 * `checkMatchScores`, exactement comme un score saisi d'un bloc avant cette
 * fonctionnalité — `decisive` garde son sens : la liste clôt la rencontre
 * (report d'équipe, « Valider le résultat ») ou note un avancement.
 */
export function checkMapList(
  format: MatchFormat | null,
  game: TournamentGame | null | undefined,
  maps: ReadonlyArray<MatchMapInput>,
  options: { decisive: boolean },
): MapListCheck {
  const score = deriveMatchScore(
    maps.map((m) => ({
      team1Score: isValidMapScore(m.team1Score) ? m.team1Score : 0,
      team2Score: isValidMapScore(m.team2Score) ? m.team2Score : 0,
    })),
  );
  const refuse = (error: MapListViolation, index: number | null = null, field: MapField = "replayCode"): MapListCheck => ({
    error,
    field: index === null ? null : { index, field },
    score,
  });

  if (maps.length === 0) return options.decisive ? refuse("MAP_LIST_EMPTY", 0) : { error: null, field: null, score };
  if (maps.length > mapListLimit(format)) return refuse("MAP_COUNT_EXCEEDED", mapListLimit(format));

  const seen = new Set<string>();
  let team1 = 0;
  let team2 = 0;
  for (const [index, map] of maps.entries()) {
    const entry = checkMapEntry(map, game, seen);
    if (entry) return refuse(entry.error, index, entry.field);
    // Une map jouée après que la rencontre est acquise n'a pas eu lieu.
    if (index > 0 && isSettled(format, team1, team2, index)) return refuse("MAP_AFTER_DECISION", index);
    const side = mapWinnerSide(map);
    if (side === 1) team1 += 1;
    else if (side === 2) team2 += 1;
  }

  // Le score dérivé suit la règle d'aujourd'hui, sans rien y ajouter.
  // Égalités ouvertes : une map nulle **consomme** une map du BO (décision du
  // 2026-10-06). Un match clos sans vainqueur a donc joué toutes ses maps —
  // un 2-2 en BO5 se justifie par une cinquième map nulle, pas par quatre maps.
  const violation =
    checkMatchScores(format, team1, team2, { decisive: options.decisive }) ??
    unplayedMapsViolation(format, team1, team2, maps.length, options.decisive);
  if (violation) return refuse(violation, maps.length - 1, "team1Score");

  return { error: null, field: null, score };
}

/** Lecture tolérante du corps `maps` d'une route ; `null` = forme invalide. */
export function parseMapListBody(raw: unknown): MatchMapInput[] | null {
  if (!Array.isArray(raw) || raw.length > FREE_FORMAT_MAP_LIMIT + 16) return null;
  const maps: MatchMapInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { replayCode, team1Score, team2Score } = entry as Record<string, unknown>;
    if (typeof replayCode !== "string" || replayCode.length > 64) return null;
    if (typeof team1Score !== "number" || typeof team2Score !== "number") return null;
    maps.push({ replayCode: normalizeReplayCode(replayCode), team1Score, team2Score });
  }
  return maps;
}

/** Deux listes décrivent-elles les mêmes maps (codes normalisés, mêmes scores) ? */
export function sameMapLists(
  a: ReadonlyArray<MatchMapInput>,
  b: ReadonlyArray<MatchMapInput>,
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (map, i) =>
        normalizeReplayCode(map.replayCode) === normalizeReplayCode(b[i].replayCode) &&
        map.team1Score === b[i].team1Score &&
        map.team2Score === b[i].team2Score,
    )
  );
}

/**
 * Les maps enregistrées ne s'affichent que si elles **expliquent** le score du
 * match : un score corrigé à la main par l'arbitrage, ou une ligne d'avant
 * cette fonctionnalité, ne doit pas porter un détail qui le contredit.
 */
export function mapsMatchStoredScore(
  maps: ReadonlyArray<MatchMapInput>,
  team1Score: number | null,
  team2Score: number | null,
): boolean {
  if (maps.length === 0) return false;
  const derived = deriveMatchScore(maps);
  return derived.team1 === team1Score && derived.team2 === team2Score;
}

/** Message en clair d'un refus, pour la notification et le champ. */
export function mapListViolationMessage(error: MapListViolation, format: MatchFormat | null, game?: TournamentGame | null): string {
  switch (error) {
    case "MAP_LIST_EMPTY":
      return "Ajoute au moins une map jouée.";
    case "MAP_COUNT_EXCEEDED":
      return `Trop de maps : ${mapListLimit(format)} au maximum pour ce match.`;
    case "MAP_REPLAY_CODE_REQUIRED":
      return "Code de replay manquant pour cette map.";
    case "MAP_REPLAY_CODE_INVALID":
      return `Code de replay invalide. ${replayCodeHint(game)}`;
    case "MAP_REPLAY_CODE_DUPLICATE":
      return "Ce code de replay figure déjà sur une autre map.";
    case "MAP_SCORE_INVALID":
      return `Score de map manquant ou invalide : un entier entre 0 et ${MAP_SCORE_MAX} (0 – 0 pour une map nulle).`;
    case "MAP_AFTER_DECISION":
      return "Cette map suit la fin du match : le résultat était déjà acquis.";
    case "MAP_LIST_INCOMPLETE":
      return format
        ? `Match inachevé : sans vainqueur, les ${matchMaxMaps(format)} maps se jouent toutes (une map nulle en occupe une).`
        : "Match inachevé.";
    case "DRAW_NOT_ALLOWED":
      return "Match nul impossible : ce tournoi exige un vainqueur.";
    case "SCORE_EXCEEDS_MATCH_FORMAT":
      return "Trop de maps gagnées pour le format du match.";
    case "SCORE_BELOW_MATCH_FORMAT":
      return format ? incompleteMessage(matchWinsRequired(format)) : "Score incomplet.";
  }
}

function incompleteMessage(wins: number): string {
  const plural = wins > 1 ? "s" : "";
  return `Score incomplet : le vainqueur doit gagner ${wins} map${plural}.`;
}

/**
 * Une map vierge, à ajouter en fin de liste : scores **vides** (`NaN`, rendu
 * vide par `<NumberInput>`), jamais un 0 – 0 inventé — une map oubliée
 * partirait sinon comme une map nulle, et passerait la validation.
 */
export function emptyMap(): MatchMapInput {
  return { replayCode: "", team1Score: Number.NaN, team2Score: Number.NaN };
}

/** La ligne porte-t-elle une saisie (code ou score) ? */
export function isMapTouched(map: MatchMapInput): boolean {
  return map.replayCode.trim() !== "" || Number.isFinite(map.team1Score) || Number.isFinite(map.team2Score);
}

/**
 * Peut-on ajouter une map ? Pas au-delà du plafond, ni une fois la rencontre
 * acquise (vainqueur désigné, ou nul acquis) — la ligne serait refusée.
 */
export function canAddMap(format: MatchFormat | null, maps: ReadonlyArray<MatchMapInput>): boolean {
  if (maps.length >= mapListLimit(format)) return false;
  const { team1, team2 } = deriveMatchScore(maps);
  return !isSettled(format, team1, team2, maps.length);
}

/** Clé d'un champ de la liste, pour le rattachement des erreurs. */
export function mapFieldKey(index: number, field: MapField): string {
  return `${index}:${field}`;
}

/** Codes de refus d'une liste de maps, pour les tables de statut des routes. */
export const MAP_LIST_ERROR_CODES: ReadonlySet<string> = new Set<MapListViolation>([
  "MAP_LIST_EMPTY",
  "MAP_COUNT_EXCEEDED",
  "MAP_REPLAY_CODE_REQUIRED",
  "MAP_REPLAY_CODE_INVALID",
  "MAP_REPLAY_CODE_DUPLICATE",
  "MAP_SCORE_INVALID",
  "MAP_AFTER_DECISION",
  "MAP_LIST_INCOMPLETE",
]);
