import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";

/** Compteurs publics de la plateforme, une seule définition pour toutes les pages qui les montrent. */
export interface SiteCounts {
  /** Comptes du site. */
  players: number;
  /**
   * « Équipes actives » : celles que l'annuaire montre — ni entrée solo
   * (`solo_user_id`), ni équipe dissoute (`deleted_at`) ; une équipe fantôme y
   * figure, comme à l'annuaire (`GHOST_TEAMS.md`).
   */
  teams: number;
  /** Tournois publiés (visibles), terminés ou non — le chiffre de l'accueil. */
  tournaments: number;
}

type CountsRow = RowDataPacket & {
  players: number | string;
  teams: number | string;
  tournaments: number | string;
};

/**
 * Lit les compteurs de la plateforme en une requête — l'accueil
 * (`landing-service.ts`) et la page de fréquentation (`audience-service.ts`)
 * publient ainsi les mêmes comptes et équipes (les « tournois joués » de
 * `/frequentation` se lisent avec ses matchs, dans `audience-service.ts`).
 * Lève si la base ne répond pas : chaque page choisit son repli.
 */
export async function readSiteCounts(): Promise<SiteCounts> {
  const db = await getDatabase();
  const [rows] = await db.execute<CountsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM bg_users) AS players,
        (SELECT COUNT(*) FROM bg_teams WHERE solo_user_id IS NULL AND deleted_at IS NULL) AS teams,
        (SELECT COUNT(*) FROM bg_tournaments WHERE start_visibility_at <= NOW()) AS tournaments
    `);
  const row = rows[0];
  return {
    players: Number(row?.players ?? 0),
    teams: Number(row?.teams ?? 0),
    tournaments: Number(row?.tournaments ?? 0),
  };
}
