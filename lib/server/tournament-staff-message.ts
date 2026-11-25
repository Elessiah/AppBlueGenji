/**
 * Message du staff d'un tournoi à ses engagés, demandé par le bot
 * (`/message-tournoi`, `docs/features/TOURNAMENT_STAFF_MESSAGE.md`).
 *
 * Seule route où le bot appelle le site (`BOT_INTEGRATION.md`, exception
 * décidée le 2026-11-25) : le site reste **seul juge** — il retrouve le compte
 * rattaché à l'identifiant Discord de l'auteur de la commande, exige la
 * permission `tournaments`, relit le tournoi et ses engagés à chaque appel, et
 * envoie par le chemin commun des notifications (`notifyUsers` : sujet coupé,
 * langue du compte, push). Rien du texte n'est gardé : il transite.
 *
 * Deux temps, une même lecture :
 * - `preview` — les destinataires **comptés** (jamais un nom ni un
 *   identifiant), pour l'aperçu éphémère du bot ;
 * - `send` — la même sélection, relue, puis l'envoi, sous un plafond par
 *   membre du staff et par tournoi réservé en **une** instruction.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { loadNotificationRecipients, notifyUsers, type NotificationRecipient } from "@/lib/server/notify";
import { onBackgroundHalt, startPeriodicClock, trackBackgroundPass } from "@/lib/server/periodic-clock";
import { usersWithTopicDisabled } from "@/lib/server/push-subscriptions";
import { parseRoles } from "@/lib/server/serialization";
import { siteUrl } from "@/lib/server/site-url";
import type { RateLimitRule } from "@/lib/server/rate-limit";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { userSuspendedSql } from "@/lib/server/suspension-sql";
import { MATCH_DM_SETTINGS_PATH } from "@/lib/shared/discord-notifications";
import { discordQuoted } from "@/lib/shared/discord-text";
import { can, sanitizePlatformRoles } from "@/lib/shared/permissions";
import { tournamentStaffMessagePush } from "@/lib/shared/push-messages";
import {
  matchesStaffMessageCategories,
  STAFF_MESSAGE_ERRORS,
  STAFF_MESSAGE_SENDS_PER_WINDOW,
  STAFF_MESSAGE_STATES,
  STAFF_MESSAGE_WINDOW_MINUTES,
  staffMessageDm,
  staffMessageRefusal,
  type StaffMessageCategory,
  type StaffMessageDelivery,
  type StaffMessageDmInput,
  type StaffMessageRecipientCounts,
} from "@/lib/shared/tournament-staff-message";
import type { TournamentState } from "@/lib/shared/types";

/** Sujet de la notification : coupé dans « Mon profil », il coupe aussi le message privé. */
const TOPIC = "TOURNAMENT_STAFF_MESSAGE" as const;

/** Étiquette côté bot : journalisée en nombres seulement, jamais un nom. */
export const STAFF_MESSAGE_CONTEXT = "tournament-staff-message";

/**
 * Envoi au bot : par lots de 25, chacun sous deux minutes. Le bot écrit à un
 * destinataire après l'autre (recherche du membre, puis message) ; le délai
 * ordinaire (15 s pour 100) couperait un plateau entier en plein envoi.
 * Geste explicite du staff, qui attend son bilan : le coupe-circuit des flux
 * de fond ne le refuse pas sans essayer.
 */
const DELIVERY = { batchSize: 25, timeoutMs: 120_000, honourCircuit: false, uncertainIsNotLost: true } as const;

/**
 * Délai au-delà duquel l'envoi répond sans attendre sa fin : nginx coupe la
 * requête du navigateur à 60 s (`proxy_read_timeout` par défaut). Un plateau
 * nombreux continue de partir en arrière-plan ; la réponse le dit
 * (`delivery.pending`) et le bilan final part au journal du staff — le staff
 * n'a pas de raison de renvoyer, ni un `504` qui l'y pousserait.
 */
export const STAFF_MESSAGE_REPLY_DEADLINE_MS = 40_000;

/**
 * Appels de la route par auteur de la commande (identifiant Discord), aperçus
 * et envois confondus : chaque aperçu relit le tournoi et ses engagés. Les
 * envois ont en plus leur plafond en base, par tournoi
 * ({@link reserveStaffMessageSend}).
 */
export const STAFF_MESSAGE_CALL_RULE: RateLimitRule = {
  name: "tournament-staff-message",
  limit: 60,
  windowMs: 10 * 60_000,
};

/** Même plafond d'appels pour la fiche du site, compté par compte de session. */
export const STAFF_MESSAGE_SITE_CALL_RULE: RateLimitRule = {
  name: "tournament-staff-message-site",
  // Le décompte se relit à chaque case cochée : plus large que celui du bot.
  limit: 120,
  windowMs: 10 * 60_000,
};

/** Refus du service : un code et son statut HTTP, rien d'autre ne sort. */
export class StaffMessageError extends Error {
  constructor(
    code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "StaffMessageError";
  }
}

/**
 * Auteur du message : un compte Discord (commande `/message-tournoi`, le site
 * retrouve le compte qui lui est rattaché) ou un compte du site (bouton
 * « Message aux participants » de la fiche, session). Dans les deux cas le
 * compte est relu ici, permission et suspension comprises.
 */
export type StaffMessageAuthor = { discordId: string } | { userId: number };

export type StaffMessageRequest = {
  author: StaffMessageAuthor;
  tournamentId: number;
  categories: readonly StaffMessageCategory[];
  message: string;
};

export type StaffMessagePreview = {
  tournament: { id: number; name: string };
  recipients: StaffMessageRecipientCounts;
};

export type StaffMessageSendResult = StaffMessagePreview & { delivery: StaffMessageDelivery };

type StaffRow = RowDataPacket & {
  id: number;
  pseudo: string;
  is_admin: number | null;
  platform_roles_json: unknown;
  suspended: number;
};

type TournamentRow = RowDataPacket & { id: number; name: string; state: TournamentState };

type EntrantRow = RowDataPacket & { user_id: number; roles_json: unknown; solo: number };

/**
 * Le compte de l'auteur (rattaché à ce Discord, ou celui de la session), qui
 * doit détenir la permission `tournaments`.
 */
async function loadStaffAccount(author: StaffMessageAuthor): Promise<{ id: number; pseudo: string }> {
  const db = await getDatabase();
  const byDiscord = "discordId" in author;
  const [rows] = await db.execute<StaffRow[]>(
    `SELECT u.id, u.pseudo, u.is_admin, u.platform_roles_json,
            ${userSuspendedSql("u.id")} AS suspended
       FROM bg_users u
      WHERE ${byDiscord ? "u.discord_id" : "u.id"} = ? AND u.is_deleted = 0
      LIMIT 1`,
    [byDiscord ? author.discordId : author.userId],
  );
  const row = rows[0];
  // Sans compte rattaché, le Discord n'est pas lié ; un compte de session
  // disparu entre-temps n'a simplement plus le droit.
  if (!row) throw new StaffMessageError(byDiscord ? STAFF_MESSAGE_ERRORS.notLinked : STAFF_MESSAGE_ERRORS.forbidden, 403);
  // Un compte suspendu n'a plus de droit effectif (même règle que la session).
  const allowed =
    Number(row.suspended) !== 1 &&
    can({ isAdmin: Number(row.is_admin ?? 0) === 1, roles: sanitizePlatformRoles(row.platform_roles_json) }, "tournaments");
  if (!allowed) throw new StaffMessageError(STAFF_MESSAGE_ERRORS.forbidden, 403);
  return { id: Number(row.id), pseudo: String(row.pseudo) };
}

async function loadTournament(tournamentId: number): Promise<{ id: number; name: string }> {
  const db = await getDatabase();
  const [rows] = await db.execute<TournamentRow[]>(
    `SELECT id, name, state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  const row = rows[0];
  if (!row) throw new StaffMessageError(STAFF_MESSAGE_ERRORS.tournamentNotFound, 404);
  if (!STAFF_MESSAGE_STATES.includes(row.state)) throw new StaffMessageError(STAFF_MESSAGE_ERRORS.tournamentClosed, 409);
  return { id: Number(row.id), name: String(row.name) };
}

/**
 * L'engagée a abandonné le tournoi : `FORFEIT` dans l'un des classements
 * rejoués (Survie, ronde suisse, BG Survie, toute phase d'un multi-phases).
 * Une engagée éliminée reste une participante ; une équipe désinscrite n'a
 * plus de ligne d'inscription.
 */
const NOT_FORFEITED = ["bg_swiss_standings", "bg_survival_standings", "bg_endurance_standings"]
  .map(
    (table) =>
      `NOT EXISTS (SELECT 1 FROM ${table} st WHERE st.tournament_id = r.tournament_id AND st.team_id = r.team_id AND st.status = 'FORFEIT')`,
  )
  .join("\n        AND ");

/**
 * Membres actuels des équipes inscrites (rôles compris) et joueurs des entrées
 * solo, hors fantômes (personne derrière), équipes dissoutes et engagées qui
 * ont abandonné.
 */
async function loadEntrants(tournamentId: number): Promise<EntrantRow[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<EntrantRow[]>(
    `SELECT tm.user_id, tm.roles_json, 0 AS solo
       FROM bg_tournament_registrations r
       JOIN bg_teams t ON t.id = r.team_id
       JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
      WHERE r.tournament_id = ?
        AND t.is_ghost = 0 AND t.solo_user_id IS NULL AND t.deleted_at IS NULL
        AND ${NOT_FORFEITED}
     UNION ALL
     SELECT t.solo_user_id AS user_id, NULL AS roles_json, 1 AS solo
       FROM bg_tournament_registrations r
       JOIN bg_teams t ON t.id = r.team_id
      WHERE r.tournament_id = ?
        AND t.is_ghost = 0 AND t.solo_user_id IS NOT NULL AND t.deleted_at IS NULL
        AND ${NOT_FORFEITED}`,
    [tournamentId, tournamentId],
  );
  return rows;
}

/** Comptes visés par les catégories, chacun une fois (un membre de deux équipes inscrites compte une fois). */
export function selectRecipientIds(rows: readonly EntrantRow[], categories: readonly StaffMessageCategory[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const solo = Number(row.solo) === 1;
    if (matchesStaffMessageCategories({ roles: solo ? [] : parseRoles(row.roles_json), solo }, categories)) {
      ids.add(Number(row.user_id));
    }
  }
  return [...ids];
}

/** Sujet coupé : la table absente (création avalée) n'a rien coupé. */
async function loadOptOuts(userIds: readonly number[]): Promise<Set<number>> {
  try {
    return await usersWithTopicDisabled(userIds, TOPIC);
  } catch (error) {
    if (isMissingTableError(error)) return new Set();
    throw error;
  }
}

type Audience = {
  counts: StaffMessageRecipientCounts;
  /** Destinataires à prévenir : sujet non coupé (Discord ou non). */
  notified: NotificationRecipient[];
};

/** Destinataires de la demande, comptés : relus à chaque appel. */
async function resolveAudience(tournamentId: number, categories: readonly StaffMessageCategory[]): Promise<Audience> {
  const ids = selectRecipientIds(await loadEntrants(tournamentId), categories);
  // Comptes supprimés écartés par le chargeur ; un compte suspendu n'est plus sollicité.
  const recipients = await loadNotificationRecipients(ids, "proven", { excludeSuspended: true });
  const optOuts = await loadOptOuts(recipients.map((recipient) => recipient.userId));
  const notified = recipients.filter((recipient) => !optOuts.has(recipient.userId));
  const reachable = notified.filter((recipient) => recipient.discord !== null).length;
  return {
    counts: {
      total: recipients.length,
      reachable,
      withoutDiscord: notified.length - reachable,
      optedOut: recipients.length - notified.length,
    },
    notified,
  };
}

function dmInput(tournament: { id: number; name: string }, message: string): StaffMessageDmInput {
  return {
    tournamentName: tournament.name,
    message,
    tournamentUrl: siteUrl(`/tournois/${tournament.id}`),
    settingsUrl: siteUrl(MATCH_DM_SETTINGS_PATH),
  };
}

/** Compte, tournoi et texte : les contrôles communs aux deux temps. */
async function authorize(request: StaffMessageRequest) {
  const staff = await loadStaffAccount(request.author);
  const tournament = await loadTournament(request.tournamentId);
  const input = dmInput(tournament, request.message);
  const refusal = staffMessageRefusal(input);
  if (refusal) throw new StaffMessageError(refusal, 400);
  return { staff, tournament, input };
}

/**
 * Comptage seul, sans texte : le décompte en direct de la fenêtre de la fiche,
 * relu à chaque catégorie cochée. Mêmes droits et même état du tournoi que
 * l'aperçu ; rien n'est envoyé ni réservé.
 */
export async function countTournamentStaffMessageRecipients(
  request: Omit<StaffMessageRequest, "message">,
): Promise<StaffMessagePreview> {
  await loadStaffAccount(request.author);
  const tournament = await loadTournament(request.tournamentId);
  const { counts } = await resolveAudience(tournament.id, request.categories);
  return { tournament, recipients: counts };
}

/** Aperçu : qui recevrait le message, compté. Rien n'est envoyé ni réservé. */
export async function previewTournamentStaffMessage(request: StaffMessageRequest): Promise<StaffMessagePreview> {
  const { tournament } = await authorize(request);
  const { counts } = await resolveAudience(tournament.id, request.categories);
  return { tournament, recipients: counts };
}

/**
 * Réserve un envoi du plafond (membre du staff, tournoi) en **une**
 * instruction : la ligne existe (insertion idempotente), puis l'`UPDATE`
 * conditionnel compte l'envoi s'il reste de la place, ou ouvre une nouvelle
 * fenêtre si la précédente est échue. `affectedRows` dit si la place est prise
 * — jamais une lecture suivie d'une écriture.
 *
 * Deux passes au plus : la purge peut effacer, entre l'insertion et l'`UPDATE`,
 * une ligne dont la fenêtre vient d'échoir — l'`UPDATE` ne trouve alors rien,
 * et la seconde passe la recrée. Une fenêtre pleine refuse aux deux passes.
 *
 * Rend la réservation (le début de sa fenêtre, relu juste après : `null` si la
 * ligne a disparu entre-temps), ou `null` si le plafond est atteint. Le
 * remboursement ({@link refundStaffMessageSend}) ne touche que cette fenêtre-là.
 */
export async function reserveStaffMessageSend(tournamentId: number, userId: number): Promise<StaffMessageReservation | null> {
  const db = await getDatabase();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await db.execute(
      `INSERT INTO bg_tournament_staff_message_quota (tournament_id, user_id, window_started_at, sends)
       VALUES (?, ?, NOW(), 0)
       ON DUPLICATE KEY UPDATE sends = sends`,
      [tournamentId, userId],
    );
    // `sends` d'abord : son expression lit l'ancienne `window_started_at`, que la
    // seconde affectation relit aussi telle quelle (elle ne dépend pas de `sends`).
    const [result] = await db.execute(
      `UPDATE bg_tournament_staff_message_quota
          SET sends = IF(window_started_at <= NOW() - INTERVAL ? MINUTE, 1, sends + 1),
              window_started_at = IF(window_started_at <= NOW() - INTERVAL ? MINUTE, NOW(), window_started_at)
        WHERE tournament_id = ? AND user_id = ?
          AND (sends < ? OR window_started_at <= NOW() - INTERVAL ? MINUTE)`,
      [
        STAFF_MESSAGE_WINDOW_MINUTES,
        STAFF_MESSAGE_WINDOW_MINUTES,
        tournamentId,
        userId,
        STAFF_MESSAGE_SENDS_PER_WINDOW,
        STAFF_MESSAGE_WINDOW_MINUTES,
      ],
    );
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1) {
      return { windowStartedAt: await readReservedWindow(tournamentId, userId) };
    }
  }
  return null;
}

/** Une place prise au plafond : la fenêtre où elle compte. */
export type StaffMessageReservation = { windowStartedAt: string | null };

type WindowRow = RowDataPacket & { window_started: string | null };

/**
 * Début de la fenêtre que la réservation vient de compter, en texte
 * (`AAAA-MM-JJ hh:mm:ss`, la précision de la colonne) : relu tel quel par le
 * remboursement, sans conversion de fuseau. Une fenêtre ne roule qu'une heure
 * après son ouverture : rien ne la change entre l'`UPDATE` et cette lecture.
 */
async function readReservedWindow(tournamentId: number, userId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<WindowRow[]>(
    `SELECT DATE_FORMAT(window_started_at, '%Y-%m-%d %H:%i:%s') AS window_started
       FROM bg_tournament_staff_message_quota
      WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId],
  );
  const value = rows[0]?.window_started;
  return typeof value === "string" ? value : null;
}

/**
 * Rend l'envoi réservé quand rien n'est parti à coup sûr (aucun message privé
 * ni push, aucun lot sans bilan) — dans **sa** fenêtre seulement : un envoi
 * long dont la fenêtre a échu entre-temps ne décompte pas l'envoi qui en a
 * ouvert une nouvelle (le plafond annoncé resterait sinon dépassable).
 */
async function refundStaffMessageSend(tournamentId: number, userId: number, reservation: StaffMessageReservation): Promise<void> {
  const db = await getDatabase();
  const sameWindow = reservation.windowStartedAt === null ? "" : " AND window_started_at = ?";
  await db.execute(
    `UPDATE bg_tournament_staff_message_quota SET sends = GREATEST(sends - 1, 0) WHERE tournament_id = ? AND user_id = ?${sameWindow}`,
    reservation.windowStartedAt === null ? [tournamentId, userId] : [tournamentId, userId, reservation.windowStartedAt],
  );
}

/** Passage de la purge des compteurs : tous les quarts d'heure, le premier peu après le démarrage. */
export const STAFF_MESSAGE_PURGE_TICK_MS = 15 * 60_000;
const STAFF_MESSAGE_PURGE_FIRST_DELAY_MS = 2 * 60_000;

/**
 * Efface les compteurs dont la fenêtre est échue : ils ne servent plus au
 * plafond. Table absente : rien à effacer. Rend le nombre de lignes effacées.
 */
export async function purgeExpiredStaffMessageQuotas(): Promise<number> {
  const db = await getDatabase();
  try {
    const [result] = await db.execute(
      `DELETE FROM bg_tournament_staff_message_quota WHERE window_started_at <= NOW() - INTERVAL ? MINUTE`,
      [STAFF_MESSAGE_WINDOW_MINUTES],
    );
    return Number((result as { affectedRows?: number }).affectedRows ?? 0);
  } catch (error) {
    if (isMissingTableError(error)) return 0;
    throw error;
  }
}

/**
 * Lance la purge des compteurs (`instrumentation.ts`, une fois par processus) :
 * une horloge, pas le trafic — un site sans visite garderait sinon des
 * compteurs au-delà de la durée annoncée (registre T04).
 */
export function startStaffMessageQuotaPurgeClock(): void {
  startPeriodicClock({
    key: "staff-message-quota-purge",
    firstDelayMs: STAFF_MESSAGE_PURGE_FIRST_DELAY_MS,
    tickMs: STAFF_MESSAGE_PURGE_TICK_MS,
    run: purgeExpiredStaffMessageQuotas,
    failureMessage: "[staff-message] Purge des compteurs impossible.",
  });
}

/** Libellés français des catégories, pour la ligne du journal (jamais un nom). */
const CATEGORY_LOG_LABELS: Readonly<Record<StaffMessageCategory, string>> = {
  PLAYERS: "joueurs",
  MANAGERS: "managers",
  CAPTAINS: "capitaines",
  OWNERS: "propriétaires",
  ALL: "tous",
};

type DeliveryContext = {
  staff: { id: number; pseudo: string };
  tournament: { id: number; name: string };
  input: StaffMessageDmInput;
  counts: StaffMessageRecipientCounts;
  notified: NotificationRecipient[];
  categories: readonly StaffMessageCategory[];
  message: string;
  reservation: StaffMessageReservation;
};

/** Début de la ligne du journal du staff : le tournoi et les catégories, jamais un nom. */
function staffLogLead(context: Pick<DeliveryContext, "tournament" | "categories">): string {
  const categories = context.categories.map((category) => CATEGORY_LOG_LABELS[category]).join(", ");
  return `📣 Message du staff aux participants du tournoi ${discordQuoted(context.tournament.name, "fr")} (${categories})`;
}

/** Publie une ligne au journal du staff (anonyme sur Discord, nominatif dans pm2), sans le texte. */
function publishStaffMessageLine(context: DeliveryContext, line: string): void {
  publishStaffAction(line, context.staff, {
    category: "tournament",
    tournamentId: context.tournament.id,
    auditLine: `${line} (tournoi #${context.tournament.id}, ${[...context.message].length} caractères, texte non gardé)`,
  });
}

/**
 * L'envoi lui-même, puis son bilan : rendu au plafond si rien n'est parti à
 * coup sûr (aucun message privé ni push, aucun lot resté sans bilan du bot),
 * noté au journal du staff.
 */
async function deliverStaffMessage(context: DeliveryContext): Promise<StaffMessageDelivery> {
  const { staff, tournament, input, counts, notified } = context;
  const sentAt = Date.now();
  let report: Awaited<ReturnType<typeof notifyUsers>>;
  try {
    report = await notifyUsers(notified, {
      topic: TOPIC,
      push: (locale) =>
        tournamentStaffMessagePush(
          { tournamentId: tournament.id, tournamentName: tournament.name, message: context.message, sentAt },
          locale,
        ),
      discord: { message: staffMessageDm(input), context: STAFF_MESSAGE_CONTEXT, delivery: DELIVERY },
      dmFollowsTopic: true,
    });
  } catch (error) {
    // Panne en plein envoi : des messages ont pu partir, l'envoi n'est pas rendu
    // au plafond. Le journal du staff le dit (sinon aucune trace), puis la panne remonte.
    publishStaffMessageLine(
      context,
      `${staffLogLead(context)} : panne pendant l'envoi (${counts.total} visé(s)) — bilan inconnu, des participants ont pu recevoir le message — par le staff.`,
    );
    throw error;
  }

  // Un lot sans réponse du bot à temps (ou coupé en route) a pu partir : ni
  // « bot injoignable », ni « non remis », ni envoi rendu au plafond — le
  // renvoyer doublerait le message de ceux qui l'ont reçu.
  const unconfirmed = report.discordUncertainUserIds?.length ?? 0;
  const botUnreachable = report.discord === null && counts.reachable > 0 && unconfirmed === 0;
  const sent = report.discord?.sent ?? 0;
  const delivery: StaffMessageDelivery = {
    sent,
    failed: Math.max(0, counts.reachable - sent - unconfirmed),
    unconfirmed,
    skipped: counts.optedOut + counts.withoutDiscord,
    pushed: report.pushed,
    botUnreachable,
    pending: false,
  };
  // Rien n'est parti à coup sûr (bot injoignable, messages privés tous refusés,
  // aucun appareil) : l'envoi ne compte pas au plafond.
  if (sent === 0 && report.pushed === 0 && unconfirmed === 0) {
    await refundStaffMessageSend(tournament.id, staff.id, context.reservation).catch((error: unknown) => {
      console.error("[staff-message] envoi non rendu au plafond", failureReason(error));
    });
  }

  const doubt = unconfirmed > 0 ? `${unconfirmed} sans bilan du bot (peut-être remis), ` : "";
  publishStaffMessageLine(
    context,
    `${staffLogLead(context)} : ` +
      `${counts.total} visé(s), ${sent} message(s) privé(s) remis, ${doubt}${delivery.failed} non remis, ${delivery.skipped} sans message privé, ${report.pushed} appareil(s) en push — par le staff.`,
  );
  return delivery;
}

/**
 * Le serveur s'arrête pendant un envoi : son arrêt n'attend qu'un instant les
 * passages de fond, et l'envoi n'aurait pas de bilan. Une ligne le dit au
 * journal du staff, posée avant le vidage du journal — le staff, à qui l'on a
 * dit de ne pas renvoyer, apprend que des participants ont pu ne rien recevoir.
 */
function staffMessageInterruptedLine(context: DeliveryContext): string {
  return (
    `${staffLogLead(context)} : le site s'arrête pendant l'envoi (${context.counts.total} visé(s)) — ` +
    `s'il ne reprend pas, une partie des participants ne recevra pas le message, et aucun autre bilan ne suivra — par le staff.`
  );
}

/** Résout `null` après `ms`, sans retenir le processus ; `cancel` arrête le minuteur. */
function replyDeadline(ms: number): { reached: Promise<null>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reached = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  return { reached, cancel: () => clearTimeout(timer) };
}

/**
 * Envoi : tout est relu (compte, permission, état du tournoi, destinataires),
 * puis un envoi est réservé au plafond, puis le message part par
 * `notifyUsers`. Le geste est publié au journal du staff — anonyme sur
 * Discord, nominatif dans pm2 —, sans le texte du message.
 *
 * Un envoi qui dépasse {@link STAFF_MESSAGE_REPLY_DEADLINE_MS} continue en
 * arrière-plan : la réponse porte alors `delivery.pending`, sans nombres
 * d'envoi, et le bilan final va au journal. Un arrêt du serveur pendant
 * l'envoi (qui n'attend qu'un instant les passages de fond) y pose une ligne
 * qui le dit ({@link onBackgroundHalt}).
 */
export async function sendTournamentStaffMessage(
  request: StaffMessageRequest,
  options: { replyDeadlineMs?: number } = {},
): Promise<StaffMessageSendResult> {
  const { staff, tournament, input } = await authorize(request);
  const { counts, notified } = await resolveAudience(tournament.id, request.categories);
  if (notified.length === 0) throw new StaffMessageError(STAFF_MESSAGE_ERRORS.noRecipients, 409);

  let reserved: StaffMessageReservation | null;
  try {
    reserved = await reserveStaffMessageSend(tournament.id, staff.id);
  } catch (error) {
    if (isMissingTableError(error)) throw new StaffMessageError(STAFF_MESSAGE_ERRORS.unavailable, 503, { cause: error });
    throw error;
  }
  if (!reserved) throw new StaffMessageError(STAFF_MESSAGE_ERRORS.quotaExceeded, 429);

  const context: DeliveryContext = {
    staff,
    tournament,
    input,
    counts,
    notified,
    categories: request.categories,
    message: request.message,
    reservation: reserved,
  };
  const stopListening = onBackgroundHalt(() => publishStaffMessageLine(context, staffMessageInterruptedLine(context)));
  const work = deliverStaffMessage(context);
  trackBackgroundPass(work);
  work.then(stopListening, stopListening);
  let answered = false;
  // Une panne après la réponse n'a plus d'appelant pour l'entendre : journalisée.
  work.catch((error: unknown) => {
    if (answered) console.error("[staff-message] envoi interrompu en arrière-plan", failureReason(error));
  });
  const deadline = replyDeadline(options.replyDeadlineMs ?? STAFF_MESSAGE_REPLY_DEADLINE_MS);
  try {
    const delivery = await Promise.race([work, deadline.reached]);
    if (delivery) return { tournament, recipients: counts, delivery };
  } finally {
    deadline.cancel();
  }
  answered = true;
  return {
    tournament,
    recipients: counts,
    delivery: {
      sent: 0,
      failed: 0,
      unconfirmed: 0,
      skipped: counts.optedOut + counts.withoutDiscord,
      pushed: 0,
      botUnreachable: false,
      pending: true,
    },
  };
}
