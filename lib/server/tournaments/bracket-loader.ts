import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { cached } from "@/lib/server/cache";
import { localizeBracketPlaceholder } from "@/lib/shared/bracket-placeholders";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";

/**
 * Durée de vie du mini-arbre de l'accueil. Il n'accompagne qu'une vignette :
 * quelques secondes de retard n'y changent rien, et la page est rendue à chaque
 * visite — sans cela, cent arrivées simultanées font cent requêtes.
 */
const MINI_BRACKET_TTL_MS = 15_000;

type MatchRow = {
  id: number;
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
  return rows.map((row) => ({
    a: row.team1_name ?? pending(row.team1_placeholder),
    b: row.team2_name ?? pending(row.team2_placeholder),
    sa: row.team1_score ?? "—",
    sb: row.team2_score ?? "—",
  }));
}

type MiniBracketRow = Pick<
  MatchRow,
  "team1_name" | "team2_name" | "team1_placeholder" | "team2_placeholder" | "team1_score" | "team2_score"
>;

async function loadMiniBracketRows(tournamentId: number): Promise<MiniBracketRow[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & MatchRow)[]>(
    `SELECT
      id,
      team1_name,
      team2_name,
      team1_placeholder,
      team2_placeholder,
      team1_score,
      team2_score
     FROM bg_matches
     WHERE tournament_id = ?
     ORDER BY FIELD(bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
              round_number ASC,
              match_number ASC
     LIMIT 4`,
    [tournamentId],
  );

  return rows.map((row) => ({
    team1_name: row.team1_name,
    team2_name: row.team2_name,
    team1_placeholder: row.team1_placeholder,
    team2_placeholder: row.team2_placeholder,
    team1_score: row.team1_score,
    team2_score: row.team2_score,
  }));
}
