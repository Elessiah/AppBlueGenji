/**
 * Journal des gestes du staff qui ne laissaient aucune trace
 * (`docs/features/STAFF_ACTION_LOGS.md`) : une ligne au journal du staff sur
 * Discord (`/internal/log`), **sans personne nommée** — ni l'auteur (« le
 * staff »), ni un joueur en tournoi individuel — et sans ligne nominative dans
 * pm2 (décision du 27 octobre 2026). Aucun push, aucun message privé : le
 * journal suffit, ces gestes n'appellent l'intervention de personne.
 *
 * Appelé par les routes **après** le geste réussi, sans attendre : le bot est
 * optionnel, et un envoi lent n'a pas à retarder la réponse. Ne lève jamais.
 */
import type { RowDataPacket } from "mysql2/promise";
import { isBotCircuitOpen, sendBotLog } from "@/lib/server/bot-integration";
import { createCoalescer, trackAnnouncement } from "@/lib/server/coalescer";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import {
  formatStaffMatchActionLog,
  formatStaffTournamentActionLog,
  type StaffActionAuthor,
  type StaffMatchAction,
  type StaffTournamentAction,
} from "@/lib/shared/bot-logs";
import { can } from "@/lib/shared/permissions";
import type { AdvanceTarget } from "@/lib/shared/tournament-launch";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";

/**
 * Auteur anonyme d'un geste : « le staff » pour qui détient la permission
 * `tournaments`, « un caster » pour qui n'a que la diffusion (`live`).
 */
export function staffActionAuthor(user: Parameters<typeof can>[0]): StaffActionAuthor {
  return can(user, "tournaments") ? "STAFF" : "CASTER";
}

/** Options d'une ligne de match : `withoutMatch`, le tournoi seul (`formatStaffMatchActionLog`). */
export type StaffMatchActionOptions = { withoutMatch?: boolean };

/** La ligne d'un geste sur un match ; rien si le match n'existe plus. Peut lever. */
export async function deliverStaffMatchAction(
  matchId: number,
  action: StaffMatchAction,
  author: StaffActionAuthor = "STAFF",
  options: StaffMatchActionOptions = {},
): Promise<void> {
  // Bot injoignable : la ligne serait jetée à l'envoi, la lecture ne sert à rien.
  if (isBotCircuitOpen()) return;
  const row = await loadMatchLogRow(matchId);
  if (!row) return;
  const match = matchLogSubject(row);
  await sendBotLog(formatStaffMatchActionLog({ ...match, action, author, withoutMatch: options.withoutMatch }), {
    tournamentId: match.tournament.id,
    category: "admin",
  });
}

type TournamentNameRow = RowDataPacket & { id: number; name: string };

/**
 * Précisions d'une ligne de tournoi (`formatStaffTournamentActionLog`) :
 * `count` (équipes fantômes), `target` (étape franchie), `previousName` (nom
 * d'avant un renommage) et `name` (nom que ce renommage a écrit, à la place
 * du nom relu à l'envoi).
 */
export type StaffTournamentActionDetails = {
  count?: number;
  target?: AdvanceTarget;
  previousName?: string;
  name?: string;
};

/** La ligne d'un geste sur un tournoi ; rien si le tournoi n'existe plus. Peut lever. */
export async function deliverStaffTournamentAction(
  tournamentId: number,
  action: StaffTournamentAction,
  details: StaffTournamentActionDetails = {},
): Promise<void> {
  if (isBotCircuitOpen()) return;
  const db = await getDatabase();
  const [rows] = await db.execute<TournamentNameRow[]>("SELECT id, name FROM bg_tournaments WHERE id = ? LIMIT 1", [
    tournamentId,
  ]);
  const tournament = rows[0];
  if (!tournament) return;
  const { name, ...wording } = details;
  await sendBotLog(
    formatStaffTournamentActionLog({
      tournament: { id: Number(tournament.id), name: name ?? tournament.name },
      action,
      ...wording,
    }),
    { tournamentId: Number(tournament.id), category: "admin" },
  );
}

/** Journalise un geste du staff sur un match, sans attendre ; ne lève jamais. */
export function announceStaffMatchAction(
  matchId: number,
  action: StaffMatchAction,
  author: StaffActionAuthor = "STAFF",
  options: StaffMatchActionOptions = {},
): void {
  // Suivie : l'arrêt du serveur attend la ligne avant de couper.
  void trackAnnouncement(
    deliverStaffMatchAction(matchId, action, author, options).catch((error) =>
      console.error(`[staff-log] geste ${action} sur le match #${matchId} non journalisé : ${failureReason(error)}`),
    ),
  );
}

/** Silence qui clôt une rafale de gestes répétés (têtes de série réordonnées cran par cran). */
export const STAFF_LOG_BURST_WINDOW_MS = 60_000;
/** Au plus tard, la rafale s'annonce ce délai après son premier geste. */
export const STAFF_LOG_BURST_MAX_AGE_MS = 5 * 60_000;

/**
 * Gestes qui se répètent en rafale : chaque cran d'un déplacement de tête de
 * série envoie son PATCH, et une équipe montée de 16e à 1re ferait quinze
 * lignes d'affilée, qui retarderaient au débit Discord les lignes suivantes —
 * litiges compris. Une rafale ne fait qu'**une** ligne par tournoi.
 */
const BURST_ACTIONS: ReadonlySet<StaffTournamentAction> = new Set(["SEEDING_REORDERED"]);

type TournamentActionBurst = { tournamentId: number; action: StaffTournamentAction; details: StaffTournamentActionDetails };

function deliverTournamentAction({ tournamentId, action, details }: TournamentActionBurst): Promise<void> {
  return deliverStaffTournamentAction(tournamentId, action, details).catch((error) =>
    console.error(`[staff-log] geste ${action} sur le tournoi #${tournamentId} non journalisé : ${failureReason(error)}`),
  );
}

const tournamentBursts = createCoalescer<TournamentActionBurst>({
  windowMs: STAFF_LOG_BURST_WINDOW_MS,
  maxAgeMs: STAFF_LOG_BURST_MAX_AGE_MS,
  deliver: (_first, last) => deliverTournamentAction(last),
});

/** Annonce tout de suite les rafales en attente. Réservé aux tests. */
export function flushStaffActionBursts(): Promise<void> {
  return tournamentBursts.flushAll();
}

/** Abandonne les rafales en attente. Réservé aux tests. */
export function resetStaffActionBursts(): void {
  tournamentBursts.reset();
  tournamentTails.clear();
}

/**
 * Journalise un geste du staff sur un tournoi, sans attendre ; ne lève jamais.
 * Un geste de rafale (`SEEDING_REORDERED`) attend {@link STAFF_LOG_BURST_WINDOW_MS}
 * de silence et ne fait qu'une ligne pour toute la rafale.
 */
export function announceStaffTournamentAction(
  tournamentId: number,
  action: StaffTournamentAction,
  details: StaffTournamentActionDetails = {},
): void {
  const entry = { tournamentId, action, details };
  if (BURST_ACTIONS.has(action)) {
    tournamentBursts.add(`${tournamentId}:${action}`, entry);
    return;
  }
  // Une rafale en attente sur ce tournoi part d'abord : le journal garde l'ordre
  // des gestes (têtes de série réordonnées, puis coup d'envoi).
  const keys = [...BURST_ACTIONS].map((burst) => `${tournamentId}:${burst}`);
  // Rien en attente (le cas courant) : la ligne part sur-le-champ, sans détour
  // par la file des microtâches — un arrêt du serveur juste après ne la rate pas.
  if (!keys.some((key) => tournamentBursts.busy(key))) {
    chainTournament(tournamentId, () => deliverTournamentAction(entry));
    return;
  }
  const flushed = Promise.all(keys.map((key) => tournamentBursts.flush(key)));
  chainTournament(tournamentId, () => flushed.then(() => deliverTournamentAction(entry)));
}

/** Dernière ligne de tournoi en route, par tournoi : la suivante part après elle. */
const tournamentTails = new Map<number, Promise<void>>();

/**
 * Enchaîne une ligne de tournoi derrière la précédente du même tournoi : un
 * geste qui suit une rafale en cours de vidage ne la double pas sur Discord.
 * Sans ligne en route, elle part sur-le-champ. Suivie : l'arrêt du serveur
 * attend sa lecture du nom du tournoi.
 */
function chainTournament(tournamentId: number, run: () => Promise<void>): void {
  const previous = tournamentTails.get(tournamentId);
  const settled = (previous ? previous.then(run, run) : run()).catch(() => undefined);
  tournamentTails.set(tournamentId, settled);
  void trackAnnouncement(settled).then(() => {
    if (tournamentTails.get(tournamentId) === settled) tournamentTails.delete(tournamentId);
  });
}
