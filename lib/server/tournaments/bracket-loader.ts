import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { cached } from "@/lib/server/cache";
import { localizeBracketPlaceholder } from "@/lib/shared/bracket-placeholders";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { visibleText } from "@/lib/shared/visible-text";

/**
 * Durée de vie du mini-arbre de l'accueil. Il n'accompagne qu'une vignette :
 * quelques secondes de retard n'y changent rien, et la page est rendue à chaque
 * visite — sans cela, cent arrivées simultanées font cent requêtes.
 */
const MINI_BRACKET_TTL_MS = 15_000;

type MatchRow = {
  id: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_placeholder: string | null;
  team2_placeholder: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

/**
 * Les quatre premiers matchs du tournoi mis en avant sur l'accueil.
 *
 * En anglais, une place vide se lit « TBD » : les libellés d'attente sont
 * **écrits en base** en français (`bracket-placeholders.ts`), et l'accueil
 * anglais ne doit en montrer aucun.
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
    rows = await cached(`mini-bracket:${tournamentId}`, MINI_BRACKET_TTL_MS, () => loadMiniBracketRows(tournamentId));
  } catch {
    return [];
  }
  const pending = (placeholder: string | null) =>
    locale === DEFAULT_LOCALE
      ? (localizeBracketPlaceholder(placeholder) ?? "À venir")
      : landingServerText(locale).t("board.tbd");
  // Lu sans compte : la forme affichable d'un nom saisi (`UNTRUSTED_NAMES.md`).
  // Une place occupée dont le nom ne garde rien de visible retombe sur « #id »,
  // neutre en langue comme au classement — jamais sur un libellé d'attente,
  // qui dirait la place encore à pourvoir.
  const entrant = (teamId: number | null, name: string | null, placeholder: string | null) => {
    if (teamId === null) return pending(placeholder);
    return (name === null ? "" : visibleText(name)) || `#${teamId}`;
  };
  return rows.map((row) => ({
    a: entrant(row.team1_id, row.team1_name, row.team1_placeholder),
    b: entrant(row.team2_id, row.team2_name, row.team2_placeholder),
    sa: row.team1_score ?? "—",
    sb: row.team2_score ?? "—",
  }));
}

type MiniBracketRow = Pick<
  MatchRow,
  "team1_id" | "team2_id" | "team1_name" | "team2_name" | "team1_placeholder" | "team2_placeholder" | "team1_score" | "team2_score"
>;

/**
 * `bg_matches` ne porte que l'identifiant des engagés : leur nom se lit dans
 * `bg_teams` (une entrée solo y a aussi sa ligne, à son pseudo). La requête
 * lisait `team1_name` / `team2_name` dans `bg_matches`, qui n'a pas ces
 * colonnes : elle levait à chaque visite et le mini-arbre ne s'affichait jamais.
 */
async function loadMiniBracketRows(tournamentId: number): Promise<MiniBracketRow[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & MatchRow)[]>(
    `SELECT
      m.id,
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
     WHERE m.tournament_id = ?
     ORDER BY FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
              m.round_number ASC,
              m.match_number ASC
     LIMIT 4`,
    [tournamentId],
  );

  return rows.map((row) => ({
    team1_id: row.team1_id === null ? null : Number(row.team1_id),
    team2_id: row.team2_id === null ? null : Number(row.team2_id),
    team1_name: row.team1_name,
    team2_name: row.team2_name,
    team1_placeholder: row.team1_placeholder,
    team2_placeholder: row.team2_placeholder,
    team1_score: row.team1_score,
    team2_score: row.team2_score,
  }));
}
