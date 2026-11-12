import { ACCOUNT_REACTIVATION_DAYS } from "@/lib/shared/account-deletion";

/**
 * La fenêtre de réactivation d'une demande de suppression, **calculée par la
 * base** (décision D67) : la date de la demande s'écrit `NOW()` et chaque
 * décision « encore ouverte / échue » se prend contre ce même `NOW()`. Node et
 * MariaDB n'ont plus à partager un fuseau pour s'accorder sur l'échéance ;
 * seul l'affichage de la date (`finalAt`) garde l'hypothèse de `toIso`.
 *
 * Les deux fragments sont complémentaires pour une date non nulle : ouverte
 * tant que `date > NOW() - 30 j`, échue dès que `date <= NOW() - 30 j` — la
 * même borne que `isReactivationWindowOpen` (`now < date + 30 j`), qui ne sert
 * plus qu'au rejeu hors ligne du journal (instants ISO absolus).
 */
const WINDOW = `INTERVAL ${Number(ACCOUNT_REACTIVATION_DAYS)} DAY`;

/** Vrai (1) tant que la réactivation reste possible ; faux (0) sans demande datée. */
export function reactivationWindowOpenSql(column = "deletion_requested_at"): string {
  return `(${column} IS NOT NULL AND ${column} > NOW() - ${WINDOW})`;
}

/** Vrai (1) quand la suppression définitive est due ; faux (0) sans demande datée. */
export function deletionDueSql(column = "deletion_requested_at"): string {
  return `(${column} IS NOT NULL AND ${column} <= NOW() - ${WINDOW})`;
}

/** Lit la colonne calculée par `reactivationWindowOpenSql` (mysql2 rend 0/1, parfois en chaîne). */
export function windowFlag(value: unknown): boolean {
  return Number(value) === 1;
}
