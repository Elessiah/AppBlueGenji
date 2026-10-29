import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { cachedLanding, LANDING_MINI_BRACKET_KEY_PREFIX } from "@/lib/server/landing-cache";
import { localizeBracketPlaceholder } from "@/lib/shared/bracket-placeholders";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { shownEntrantName } from "@/lib/shared/visible-text";
import type { BracketType, MatchStatus } from "@/lib/shared/types";

/**
 * Durée de vie du mini-arbre de l'accueil. Il n'accompagne qu'une vignette :
 * quelques secondes de retard n'y changent rien, et la page est rendue à chaque
 * visite — sans cela, cent arrivées simultanées font cent requêtes. L'entrée vit
 * sous le préfixe de la vitrine (`landing-cache.ts`) : une écriture de tournoi,
 * une dissolution ou une suppression de compte la vident avec le reste de
 * l'accueil.
 */
const MINI_BRACKET_TTL_MS = 15_000;

/** Nombre de matchs montrés par la vignette. */
export const MINI_BRACKET_SIZE = 4;

/** Ordre des tableaux : le principal d'abord, comme sur la fiche du tournoi. */
const BRACKET_ORDER: readonly BracketType[] = ["UPPER", "LOWER", "GRAND", "THIRD_PLACE"];

/** Un match du tournoi, tel que la vignette le lit (`bg_matches` + noms de `bg_teams`). */
export type MiniBracketRow = {
  phaseId: number;
  bracket: BracketType;
  roundNumber: number;
  matchNumber: number;
  status: MatchStatus;
  isBye: boolean;
  team1Id: number | null;
  team2Id: number | null;
  team1Name: string | null;
  team2Name: string | null;
  team1Placeholder: string | null;
  team2Placeholder: string | null;
  team1Score: number | null;
  team2Score: number | null;
};

/**
 * Garde, parmi `candidates`, le niveau (phase, manche) à montrer : le premier
 * qui a encore un match à jouer, sinon — tout est joué — le dernier.
 */
function pickLevel(candidates: readonly MiniBracketRow[], level: (row: MiniBracketRow) => number): MiniBracketRow[] {
  const open = candidates.filter((row) => row.status !== "COMPLETED");
  const target = open.length > 0
    ? Math.min(...open.map(level))
    : Math.max(...candidates.map(level));
  return candidates.filter((row) => level(row) === target);
}

/**
 * Les matchs que montre la vignette : ceux de la **manche en cours** du tableau
 * principal, sinon (tout est joué) de sa dernière manche — et non plus toujours
 * la manche 1, qui faisait passer les premiers résultats d'un tournoi Suisse,
 * Survie ou multi-phases en manche 4 pour « le » plateau.
 *
 * - phase : la première qui garde un match à jouer, sinon la dernière ;
 * - tableau : `UPPER` s'il existe dans cette phase, sinon le premier présent ;
 * - manche : la première qui garde un match à jouer, sinon la dernière ;
 * - au plus {@link MINI_BRACKET_SIZE} matchs, dans l'ordre des numéros.
 */
export function pickMiniBracketMatches(rows: readonly MiniBracketRow[]): MiniBracketRow[] {
  if (rows.length === 0) return [];
  const inPhase = pickLevel(rows, (row) => row.phaseId);
  const bracket = BRACKET_ORDER.find((name) => inPhase.some((row) => row.bracket === name));
  const inBracket = inPhase.filter((row) => row.bracket === bracket);
  return pickLevel(inBracket, (row) => row.roundNumber)
    .sort((left, right) => left.matchNumber - right.matchNumber)
    .slice(0, MINI_BRACKET_SIZE);
}

/**
 * Les matchs de la manche en cours du tournoi mis en avant sur l'accueil
 * ({@link pickMiniBracketMatches}).
 *
 * En anglais, une place vide se lit « TBD » : les libellés d'attente sont
 * **écrits en base** en français (`bracket-placeholders.ts`), et l'accueil
 * anglais ne doit en montrer aucun. La place vide d'une **exemption** (`is_bye`)
 * se lit « Exempt » / « Bye » : son adversaire ne viendra jamais, « À venir »
 * le ferait attendre.
 */
export async function loadMiniBracket(
  tournamentId: number,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ a: string; b: string; sa: number | string; sb: number | string }[]> {
  // Un incident de lecture n'est pas mis en cache : `cached` ne mémorise jamais
  // un rejet, et la visite suivante retentera plutôt que de servir une vignette
  // vide pendant quinze secondes.
  // Les lignes brutes sont mises en cache une fois pour les deux langues ;
  // seule la place vide se rédige à la sortie.
  let rows: MiniBracketRow[];
  try {
    rows = await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}${tournamentId}`, MINI_BRACKET_TTL_MS, () =>
      loadMiniBracketRows(tournamentId),
    );
  } catch {
    return [];
  }
  const { t } = landingServerText(locale);
  const pending = (placeholder: string | null) =>
    locale === DEFAULT_LOCALE ? (localizeBracketPlaceholder(placeholder) ?? t("board.tbd")) : t("board.tbd");
  // Lu sans compte : la forme affichable d'un nom saisi, même règle que le
  // direct et le bandeau (`shownEntrantName`). Une place occupée dont le nom ne
  // garde rien de visible retombe sur « #id », neutre en langue comme au
  // classement — jamais sur un libellé d'attente, qui dirait la place encore à
  // pourvoir.
  const entrant = (row: MiniBracketRow, teamId: number | null, name: string | null, placeholder: string | null) => {
    if (teamId !== null) return shownEntrantName(name) ?? `#${teamId}`;
    return row.isBye ? t("board.bye") : pending(placeholder);
  };
  return pickMiniBracketMatches(rows).map((row) => ({
    a: entrant(row, row.team1Id, row.team1Name, row.team1Placeholder),
    b: entrant(row, row.team2Id, row.team2Name, row.team2Placeholder),
    sa: row.team1Score ?? "—",
    sb: row.team2Score ?? "—",
  }));
}

type MatchRow = RowDataPacket & {
  phase_id: number | string | null;
  bracket: BracketType;
  round_number: number | string;
  match_number: number | string;
  status: MatchStatus;
  is_bye: number | boolean | null;
  team1_id: number | string | null;
  team2_id: number | string | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_placeholder: string | null;
  team2_placeholder: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

const orNull = (value: number | string | null) => (value === null ? null : Number(value));

/**
 * Tous les matchs du tournoi, la manche se choisissant à la lecture
 * ({@link pickMiniBracketMatches}) : quelques centaines de lignes au plus,
 * lues une fois par quinze secondes pour toutes les visites.
 *
 * `bg_matches` ne porte que l'identifiant des engagés : leur nom se lit dans
 * `bg_teams` (une entrée solo y a aussi sa ligne, à son pseudo). La requête
 * lisait `team1_name` / `team2_name` dans `bg_matches`, qui n'a pas ces
 * colonnes : elle levait à chaque visite et le mini-arbre ne s'affichait jamais.
 */
async function loadMiniBracketRows(tournamentId: number): Promise<MiniBracketRow[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<MatchRow[]>(
    `SELECT
      m.phase_id,
      m.bracket,
      m.round_number,
      m.match_number,
      m.status,
      m.is_bye,
      m.team1_id,
      m.team2_id,
      t1.name AS team1_name,
      t2.name AS team2_name,
      m.team1_placeholder,
      m.team2_placeholder,
      m.team1_score,
      m.team2_score
     FROM bg_matches m
     LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
     LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
     WHERE m.tournament_id = ?`,
    [tournamentId],
  );

  return rows.map((row) => ({
    phaseId: Number(row.phase_id ?? 0),
    bracket: row.bracket,
    roundNumber: Number(row.round_number),
    matchNumber: Number(row.match_number),
    status: row.status,
    isBye: Boolean(Number(row.is_bye ?? 0)),
    team1Id: orNull(row.team1_id),
    team2Id: orNull(row.team2_id),
    team1Name: row.team1_name,
    team2Name: row.team2_name,
    team1Placeholder: row.team1_placeholder,
    team2Placeholder: row.team2_placeholder,
    team1Score: row.team1_score,
    team2Score: row.team2_score,
  }));
}
