import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import type { AuthUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { canViewTournament } from "@/lib/shared/tournament-visibility";

type VisibilityRow = RowDataPacket & { start_visibility_at: Date | string };

/**
 * Ce joueur peut-il **agir** sur ce tournoi — ou faut-il lui répondre 404 ?
 *
 * Les deux portes de lecture taisent un tournoi non publié derrière un 404
 * (`getVisibleTournamentSnapshot`). Les routes d'écriture des joueurs
 * (inscription, signalement, abandon, report de score, forfait sur une manche)
 * n'avaient, elles, aucune raison de le consulter — un tournoi caché est
 * toujours `UPCOMING`, rien n'y est jouable —, mais leurs refus en disaient
 * trop : `TOURNAMENT_NOT_FOUND` pour un identifiant inexistant, un autre code
 * (`REGISTRATION_CLOSED`, `NOT_REGISTERED`, `TOURNAMENT_NOT_RUNNING`…) pour un
 * tournoi en préparation. L'identifiant étant un entier consécutif, un compte
 * sans rôle énumérait les tournois cachés en lisant les codes d'erreur.
 *
 * `false` recouvre donc « n'existe pas » et « pas pour vous », que l'appelant
 * traduit en un même 404, **avant** tout autre contrôle. Même règle pure que la
 * lecture (`canViewTournament`), même public : la permission `tournaments` voit
 * tout, sans lecture en base — le service lui répondra lui-même 404 sur un
 * identifiant inexistant, elle n'a rien à cacher à qui voit déjà la liste.
 */
export async function canActOnTournament(tournamentId: number, user: AuthUser): Promise<boolean> {
  if (can(user, "tournaments")) return true;
  const db = await getDatabase();
  const [rows] = await db.execute<VisibilityRow[]>(
    "SELECT start_visibility_at FROM bg_tournaments WHERE id = ? LIMIT 1",
    [tournamentId],
  );
  const row = rows[0];
  if (!row) return false;
  return canViewTournament({ startVisibilityAt: row.start_visibility_at }, { canManage: false });
}
