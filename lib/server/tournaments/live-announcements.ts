/**
 * Annonce des lives sur Discord : au **début** d'un match diffusé, le bot poste
 * dans le salon #live du serveur BlueGenji un message `@everyone` qui nomme les
 * deux engagés, le tournoi, et donne le lien de la diffusion.
 *
 * **« Début du match » = passage à l'antenne**, tel que le site le dérive
 * (`isMatchLive`, `lib/shared/live-streams.ts`) : au lancement du match en
 * `AUTO`, à l'heure dite en `START_TIME`, au clic « Lancer le direct » en
 * `MANUAL`. Il n'existe qu'une définition de « ce match est à l'antenne », et
 * l'annonce la lit au lieu d'en écrire une seconde.
 *
 * **Un balayage, pas un crochet par écriture.** Cinq écritures différentes
 * posent `launched_at`, et le mode `START_TIME` passe à l'antenne **sans
 * aucune écriture**. Le balayage suit donc les mêmes déclencheurs que les
 * notifications de départ (`./player-pushes`) : chaque évènement de tournoi
 * publié, l'entretien de l'instantané qui ouvre un lancement, et la lecture de
 * la liste des tournois. Étranglé à dix secondes, avec relève ; une minute
 * de pause après une annonce reportée.
 *
 * **Une annonce par match et par affiche** (`bg_live_announcements`, clé
 * unique `(match_id, pairing)`), réservée avant l'appel au bot : un balayage
 * concurrent, un rafraîchissement, une relecture du flux ou un direct coupé
 * puis relancé ne reposte jamais. La réservation n'est **rendue** que si rien
 * n'est parti (bot injoignable, salon fermé) — le balayage suivant réessaie
 * tant que le match est à l'antenne. Elle disparaît avec la ligne du match
 * (suppression, retour en arrière, plateau régénéré) : un match recréé puis
 * relancé est annoncé de nouveau. Une affiche changée (ré-appariement) est une
 * autre rencontre, donc une autre annonce.
 *
 * **Un message par diffusion, pas par match.** Les matchs d'un même tournoi
 * qu'un même passage trouve à l'antenne sur le même lien (une ronde lancée
 * d'un coup, repliée sur la chaîne officielle) partent en un seul message :
 * le serveur ne reçoit pas quatre `@everyone` en quelques secondes vers la
 * même chaîne. Chaque affiche garde sa propre réservation.
 *
 * **Fraîcheur : deux heures.** Un match n'est annoncé que dans les deux heures
 * qui suivent son passage à l'antenne (`LIVE_ANNOUNCE_MAX_AGE_MINUTES`) : un
 * déploiement, une table recréée ou une longue panne du bot ne réveillent
 * jamais `@everyone` pour un match commencé depuis longtemps.
 *
 * **Production seulement** : une base de développement (seed `Test_`) ne doit
 * jamais faire écrire `@everyone` à 1 200 personnes, même devant un bot local
 * branché par erreur sur le vrai serveur.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushLiveAnnouncement, type LiveAnnouncementOutcome } from "@/lib/server/bot-integration";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { formatLiveAnnouncementGroup, liveAnnouncementUrl } from "@/lib/shared/live-announcements";
import { isMatchLive, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import type { MatchStatus } from "@/lib/shared/types";

type LiveCandidateRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  tournament_live_url: string | null;
  status: MatchStatus;
  start_at: Date | string | null;
  live_trigger: MatchLiveTrigger;
  live_started_at: Date | string | null;
  live_url: string | null;
  launched_at: Date | string | null;
  pairing: string;
  launch_pairing: string | null;
  team1_name: string;
  team2_name: string;
  team1_solo_user_id: number | null;
  team2_solo_user_id: number | null;
};

/**
 * Âge maximal, en minutes, d'un passage à l'antenne encore annonçable. Mesuré
 * par l'horloge de la base (`NOW()`), comme les autres colonnes `DATETIME` du
 * moteur : aucun décalage de fuseau entre le processus et le serveur SQL.
 */
export const LIVE_ANNOUNCE_MAX_AGE_MINUTES = 120;

/**
 * Passage à l'antenne récent, selon le mode : lancement (`AUTO`), heure dite
 * — ou, pour un match devenu jouable après son heure, son lancement — en
 * `START_TIME`, ouverture d'antenne en `MANUAL`. Une colonne vide ne passe pas.
 * Un `START_TIME` dont l'heure n'est pas venue n'est pas lu : il n'est pas à
 * l'antenne, et un plateau programmé d'avance le relirait à chaque passage.
 */
const FRESH_ON_AIR_SQL = `(
        (m.live_trigger = 'AUTO' AND m.launched_at > NOW() - INTERVAL ${LIVE_ANNOUNCE_MAX_AGE_MINUTES} MINUTE)
        OR (m.live_trigger = 'START_TIME' AND m.start_at <= NOW()
            AND (m.start_at > NOW() - INTERVAL ${LIVE_ANNOUNCE_MAX_AGE_MINUTES} MINUTE
                 OR (m.launched_at > NOW() - INTERVAL ${LIVE_ANNOUNCE_MAX_AGE_MINUTES} MINUTE
                     AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id))))
        OR (m.live_trigger = 'MANUAL' AND m.live_started_at > NOW() - INTERVAL ${LIVE_ANNOUNCE_MAX_AGE_MINUTES} MINUTE)
      )`;

/** Vrai si les annonces peuvent partir : en production seulement. */
export function liveAnnouncementsEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Matchs castés, jouables, d'un tournoi en cours, passés à l'antenne depuis
 * moins de deux heures, dont l'affiche courante n'a pas encore été annoncée. Le passage à l'antenne se décide ensuite **en
 * mémoire** (`isMatchLive`), comme pour le bouton d'accueil : leur nombre est
 * marginal, et aucune requête ne réimplémente la règle en SQL.
 */
async function loadCandidates(): Promise<LiveCandidateRow[]> {
  const db = await getDatabase();
  const [rows] = await db.query<LiveCandidateRow[]>(
    `SELECT m.id, m.tournament_id, t.name AS tournament_name, t.participant_type,
            t.live_url AS tournament_live_url, m.status, m.start_at, m.live_trigger,
            m.live_started_at, m.live_url, m.launched_at, m.launch_pairing,
            CONCAT(m.team1_id, ':', m.team2_id) AS pairing,
            t1.name AS team1_name, t2.name AS team2_name,
            t1.solo_user_id AS team1_solo_user_id, t2.solo_user_id AS team2_solo_user_id
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
                            AND t.state = 'RUNNING' AND t.start_visibility_at <= NOW()
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.live_trigger IS NOT NULL AND m.status = 'READY' AND m.is_bye = 0
        AND ${FRESH_ON_AIR_SQL}
        AND NOT EXISTS (SELECT 1 FROM bg_live_announcements a
                         WHERE a.match_id = m.id AND a.pairing = CONCAT(m.team1_id, ':', m.team2_id))
      ORDER BY m.id`,
  );
  return rows;
}

/** Vrai si le match est à l'antenne maintenant, lancement de l'affiche courante seulement. */
function isOnAir(row: LiveCandidateRow, now: number): boolean {
  return isMatchLive(
    {
      status: row.status,
      liveTrigger: row.live_trigger,
      liveStartedAt: row.live_started_at,
      startAt: row.start_at,
      // Un lancement posé pour une autre paire ne compte pas (`currentLaunchState`).
      launchedAt: row.launch_pairing === row.pairing ? row.launched_at : null,
    },
    now,
  );
}

/** Réserve l'annonce d'une affiche ; `false` si un autre passage l'a prise. */
async function claimAnnouncement(matchId: number, pairing: string): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_live_announcements (match_id, pairing) VALUES (?, ?)`,
    [matchId, pairing],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Rend les réservations d'un groupe, en une requête : rien n'est parti, le
 * prochain balayage réessaiera.
 *
 * @param label Les matchs et leur tournoi, pour la trace d'un échec.
 * @returns `false` si la base a refusé : l'annonce ne sera pas réessayée.
 */
async function releaseAnnouncements(rows: readonly LiveCandidateRow[], label: string): Promise<boolean> {
  try {
    const db = await getDatabase();
    const placeholders = rows.map(() => "(?, ?)").join(", ");
    const params = rows.flatMap((row) => [Number(row.id), String(row.pairing)]);
    await db.execute(`DELETE FROM bg_live_announcements WHERE (match_id, pairing) IN (${placeholders})`, params);
    return true;
  } catch (error) {
    const lost = rows.length > 1 ? "annonces non réessayées" : "annonce non réessayée";
    console.error(`[live-announce] ${label} : réservation non rendue, ${lost}`, error);
    return false;
  }
}

/** Matchs réservés d'un même tournoi, à l'antenne sur un même lien. */
interface AnnouncementGroup {
  url: string;
  rows: LiveCandidateRow[];
}

/** Délai entre deux avertissements pm2 d'une même panne : le balayage réessaie toutes les dix secondes. */
const LIVE_WARN_COOLDOWN_MS = 60 * 60 * 1000;

const lastWarnAt = new Map<string, number>();

/** Taille au-delà de laquelle les avertissements échus sont oubliés. */
const LIVE_WARN_PRUNE_SIZE = 200;

/**
 * Oublie les avertissements dont le délai est passé : une clé par match ou par
 * groupe en échec, et le processus pm2 tourne des semaines.
 */
function pruneWarnings(now: number): void {
  if (lastWarnAt.size < LIVE_WARN_PRUNE_SIZE) return;
  for (const [kind, at] of lastWarnAt) {
    if (now - at >= LIVE_WARN_COOLDOWN_MS) lastWarnAt.delete(kind);
  }
}

/**
 * Avertit pm2, au plus une fois par heure et par clé : la cause **et** les
 * matchs, pour que chaque match reporté laisse sa trace sans que le balayage,
 * qui repasse toutes les dix secondes, n'inonde le journal.
 *
 * @param error Erreur jointe : la trace part alors en `console.error`.
 */
function warnOnce(kind: string, message: string, error?: unknown): void {
  const now = Date.now();
  const last = lastWarnAt.get(kind);
  if (last !== undefined && now - last < LIVE_WARN_COOLDOWN_MS) return;
  pruneWarnings(now);
  lastWarnAt.set(kind, now);
  const text = `${message} (avertissement répété au plus une fois par heure)`;
  if (error === undefined) console.warn(text);
  else console.error(text, error);
}

/** Longueur maximale de la liste d'identifiants dans l'étiquette envoyée au bot (200 caractères en tout). */
const CONTEXT_IDS_MAX_LENGTH = 150;

/** « 40,41,42 », ou « 40,41,…+12 » quand la liste ne tient pas : jamais un identifiant coupé. */
function contextIds(ids: readonly number[]): string {
  const all = ids.join(",");
  if (all.length <= CONTEXT_IDS_MAX_LENGTH) return all;
  let shown = "";
  let count = 0;
  for (const id of ids) {
    const next = count === 0 ? String(id) : `${shown},${id}`;
    if (`${next},…+${ids.length - count - 1}`.length > CONTEXT_IDS_MAX_LENGTH) break;
    shown = next;
    count += 1;
  }
  return `${shown},…+${ids.length - count}`;
}

/** Identifiants des matchs d'un groupe. */
function matchIdsOf(group: AnnouncementGroup): number[] {
  return group.rows.map((row) => Number(row.id));
}

/**
 * Type d'engagés d'un groupe. Une entrée individuelle (`solo_user_id`) porte le
 * nom de son joueur : elle s'écrit « un joueur » même si le type du tournoi
 * était illisible — un pseudo ne part jamais devant tout le serveur.
 */
function groupParticipantType(rows: readonly LiveCandidateRow[]): ParticipantType {
  const solo = rows.some((row) => row.team1_solo_user_id != null || row.team2_solo_user_id != null);
  return solo ? "SOLO" : toParticipantType(rows[0].participant_type);
}

/**
 * Issues qui abandonnent l'annonce (réservation gardée), et ce que pm2 en dit.
 * Aucune ne demande de la poster à la main : l'envoi du bot a pu partir, ou
 * partir encore.
 */
const ABANDONED_OUTCOMES: Partial<Record<LiveAnnouncementOutcome, string>> = {
  rejected: "annonce refusée par le bot, abandonnée",
  "discord-refused":
    "une règle AutoMod du serveur a bloqué l'annonce (détail au canal de logs du bot, ou dans ses journaux si la règle a bloqué aussi le signalement), abandonnée : le même message serait bloqué de nouveau",
  // L'envoi est terminé : ce que montre #live fait foi.
  uncertain:
    "publication non confirmée (Discord en panne pendant l'envoi), annonce peut-être publiée, non réessayée — vérifier #live",
  // L'envoi du bot peut encore aboutir : #live vide maintenant ne prouve rien.
  "timed-out":
    "bot sans réponse à temps, son envoi peut encore aboutir (Discord lent, limite de débit), annonce non réessayée",
};

/** Cause pm2 d'un refus ou d'un silence de Discord rapporté par le bot. */
const DISCORD_HELD_CAUSE =
  "Discord a refusé l'annonce (état du salon) ou n'a pas répondu au bot — cause au canal de logs ou dans les journaux du bot";

/** Issues qui reportent l'annonce (réservation rendue), et leur cause dans pm2. */
const POSTPONED_CAUSES: Partial<Record<LiveAnnouncementOutcome, string>> & { unavailable: string } = {
  "channel-closed": "salon #live fermé au bot (introuvable ou sans permission d'écrire)",
  "discord-held": DISCORD_HELD_CAUSE,
  // Même phrase : le staff lit la cause exacte au canal de logs du bot.
  "discord-unreachable": DISCORD_HELD_CAUSE,
  unavailable: "bot injoignable, en panne ou d'une version sans annonces",
};

/** Issues qui reportent l'annonce. */
type PostponedOutcome = keyof typeof POSTPONED_CAUSES;

/**
 * Reports qui valent pour tout envoi : le bot (injoignable, ancien), le salon
 * (fermé) ou Discord muet en lisant le salon. Un refus de Discord
 * (`discord-held`) peut tenir au message lui-même : les autres groupes sont
 * alors essayés quand même.
 */
const SHARED_POSTPONEMENTS: ReadonlySet<PostponedOutcome> = new Set<PostponedOutcome>([
  "unavailable",
  "channel-closed",
  "discord-unreachable",
]);

/** Ce que les traces pm2 et le bot disent d'un groupe : ses matchs et son tournoi. */
function describeGroup(group: AnnouncementGroup): { label: string; context: string; plural: boolean } {
  const [first] = group.rows;
  const ids = matchIdsOf(group);
  const plural = ids.length > 1;
  const noun = plural ? "matchs" : "match";
  return {
    label: `${noun} ${ids.join(", ")} (tournoi ${Number(first.tournament_id)})`,
    // Le tournoi en tête : le staff ouvre `/tournois/<id>` depuis le canal de logs.
    context: `live-announce tournoi-${Number(first.tournament_id)} match-${contextIds(ids)}`,
    plural,
  };
}

/**
 * Reporte un groupe : rend ses réservations et le dit dans pm2, puis attend
 * {@link LIVE_ANNOUNCE_RETRY_DELAY_MS} avant de redemander — redemander toutes
 * les dix secondes renverrait le même refus. La pause vaut pour tout le
 * processus quand le bot ou le salon sont en cause ({@link SHARED_POSTPONEMENTS}),
 * pour les seuls matchs du groupe sinon : un refus qui peut tenir au message ne
 * retarde pas les autres tournois.
 */
async function postpone(group: AnnouncementGroup, outcome: PostponedOutcome): Promise<void> {
  if (SHARED_POSTPONEMENTS.has(outcome)) postponeRetries();
  else holdMatches(group.rows);
  const { label, context, plural } = describeGroup(group);
  if (!(await releaseAnnouncements(group.rows, label))) return;
  const retry = plural
    ? "annonces reportées, réessayées tant que les matchs ont commencé depuis moins de deux heures"
    : "annonce reportée, réessayée tant que le match a commencé depuis moins de deux heures";
  const cause = POSTPONED_CAUSES[outcome] ?? POSTPONED_CAUSES.unavailable;
  warnOnce(`${outcome} ${context}`, `[live-announce] ${label} : ${cause}, ${retry}`);
}

/**
 * Annonce un groupe réservé.
 *
 * @returns Le nombre de matchs publiés, et l'issue si l'annonce est reportée.
 */
async function announce(group: AnnouncementGroup): Promise<{ posted: number; postponed: PostponedOutcome | null }> {
  const [first] = group.rows;
  const message = formatLiveAnnouncementGroup({
    tournamentName: String(first.tournament_name),
    participantType: groupParticipantType(group.rows),
    pairings: group.rows.map((row) => ({ team1Name: String(row.team1_name), team2Name: String(row.team2_name) })),
  });
  const { label, context, plural } = describeGroup(group);
  const outcome = await pushLiveAnnouncement(message, group.url, context);
  if (outcome === "posted" || outcome === "posted-silent") {
    // Trace pm2 pour le staff : identifiants seulement, aucun nom.
    const silent = outcome === "posted-silent" ? " sans notifier (permission de mentionner @everyone absente)" : "";
    const announced = plural ? "annoncés" : "annoncé";
    console.info(`[live-announce] ${label} ${announced} dans #live${silent}`);
    return { posted: group.rows.length, postponed: null };
  }
  const abandoned = ABANDONED_OUTCOMES[outcome];
  if (abandoned) {
    // Rien à renvoyer : refusé tel quel, ou peut-être déjà publié (un second
    // `@everyone` serait pire qu'une annonce perdue). Réservations gardées.
    console.error(`[live-announce] ${label} : ${abandoned}`);
    return { posted: 0, postponed: null };
  }
  const postponed: PostponedOutcome = outcome in POSTPONED_CAUSES ? (outcome as PostponedOutcome) : "unavailable";
  await postpone(group, postponed);
  return { posted: 0, postponed };
}

/**
 * Réserve l'affiche d'un match ; `false` si un autre passage l'a prise ou si
 * la base a refusé. Une réservation refusée (verrou, panne) ne doit pas
 * emporter les affiches déjà réservées de ce passage : elles partent.
 */
async function tryClaim(row: LiveCandidateRow): Promise<boolean> {
  try {
    return await claimAnnouncement(Number(row.id), String(row.pairing));
  } catch (error) {
    warnOnce(
      `claim ${Number(row.id)}`,
      `[live-announce] match ${Number(row.id)} (tournoi ${Number(row.tournament_id)}) : réservation impossible, réessayée à chaque passage pendant les deux heures qui suivent le début du direct`,
      error,
    );
    return false;
  }
}

/**
 * Un passage : réserve puis annonce chaque match passé à l'antenne, groupés
 * par tournoi et par lien.
 *
 * @param now Instant de référence, injectable pour les tests.
 * @returns Le nombre de matchs annoncés.
 */
export async function runLiveAnnouncementSweep(now: number = Date.now()): Promise<number> {
  // Bot en panne : rien ne pourrait partir, inutile de relire la base.
  if (isBotCircuitOpen()) return 0;
  const rows = await loadCandidates();
  const groups = new Map<string, AnnouncementGroup>();
  for (const row of rows) {
    if (!isOnAir(row, now) || isHeld(Number(row.id))) continue;
    // Pas de lien exploitable, pas d'annonce : il n'y aurait rien à regarder.
    const url = liveAnnouncementUrl(row.live_url, row.tournament_live_url);
    if (!url) {
      warnOnce(
        `no-link ${Number(row.id)}`,
        `[live-announce] match ${Number(row.id)} (tournoi ${Number(row.tournament_id)}) à l'antenne sans lien de diffusion exploitable (ni le match ni le tournoi) : pas d'annonce pour l'instant — un lien ajouté dans les deux heures qui suivent le début du direct la fera partir, ne pas la poster à la main`,
      );
      continue;
    }
    // Bot en panne : ne rien réserver qu'on sait ne pas pouvoir envoyer.
    if (isBotCircuitOpen()) break;
    if (!(await tryClaim(row))) continue;
    const key = `${Number(row.tournament_id)} ${url}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { url, rows: [row] });
  }
  return announceGroups(groups.values());
}


/**
 * Annonce les groupes l'un après l'autre. Un report qui tient au bot ou au
 * salon vaut pour les suivants du passage : ils sont rendus sans appel, au
 * lieu d'essuyer le même refus.
 *
 * @returns Le nombre de matchs publiés.
 */
async function announceGroups(groups: Iterable<AnnouncementGroup>): Promise<number> {
  let posted = 0;
  let postponed: PostponedOutcome | null = null;
  for (const group of groups) {
    if (postponed) {
      await postpone(group, postponed);
      continue;
    }
    const result = await announce(group);
    posted += result.posted;
    if (result.postponed && SHARED_POSTPONEMENTS.has(result.postponed)) postponed = result.postponed;
  }
  return posted;
}

/** Étranglement : le balayage suit chaque évènement de tournoi. */
const LIVE_ANNOUNCE_THROTTLE_MS = 10_000;

/**
 * Pause après une annonce reportée (bot injoignable ou d'une version sans
 * annonces, salon #live fermé, Discord réticent) : la même cause renverrait le
 * même refus toutes les dix secondes, pendant deux heures — réservation, appel
 * au bot et lecture du salon chez Discord à chaque fois.
 */
export const LIVE_ANNOUNCE_RETRY_DELAY_MS = 60_000;

let retryNotBefore = 0;

/** Matchs dont l'annonce a été refusée par Discord, et l'instant de leur prochain essai. */
const heldUntil = new Map<number, number>();

/** Met en pause les seuls matchs d'un groupe refusé. */
function holdMatches(rows: readonly LiveCandidateRow[]): void {
  const now = Date.now();
  // Un match sorti de l'antenne n'est plus relu : sa pause échue s'oublie ici.
  for (const [matchId, at] of heldUntil) if (at <= now) heldUntil.delete(matchId);
  const until = now + LIVE_ANNOUNCE_RETRY_DELAY_MS;
  for (const row of rows) heldUntil.set(Number(row.id), until);
}

/** Vrai si le match attend encore son prochain essai ; oublie les pauses échues. */
function isHeld(matchId: number): boolean {
  const until = heldUntil.get(matchId);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  heldUntil.delete(matchId);
  return false;
}

/** Reporte le prochain balayage d'une {@link LIVE_ANNOUNCE_RETRY_DELAY_MS}. */
function postponeRetries(): void {
  retryNotBefore = Date.now() + LIVE_ANNOUNCE_RETRY_DELAY_MS;
}

let lastSweepAt = 0;
let pendingSweep: Promise<number> | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Relève : un appel étranglé, ou arrivé pendant un passage dont la lecture a
 * pu précéder le passage à l'antenne, ne doit pas être perdu.
 */
function scheduleTrailingSweep(delayMs: number): void {
  if (trailingTimer) return;
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    void dispatchLiveAnnouncements();
  }, Math.max(0, delayMs));
  trailingTimer.unref?.();
}

/**
 * Annonce les lives dus. Jamais bloquant, jamais une exception : l'appelant
 * est une écriture déjà faite ou une lecture de page.
 *
 * @returns Le nombre d'annonces publiées (0 si étranglé ou désactivé).
 */
export async function dispatchLiveAnnouncements(): Promise<number> {
  if (!liveAnnouncementsEnabled()) return 0;
  if (pendingSweep) {
    scheduleTrailingSweep(LIVE_ANNOUNCE_THROTTLE_MS);
    return pendingSweep;
  }
  const now = Date.now();
  // Pause après un report : la relève tombe à son terme.
  if (now < retryNotBefore) {
    scheduleTrailingSweep(retryNotBefore - now);
    return 0;
  }
  const sinceLast = now - lastSweepAt;
  if (sinceLast < LIVE_ANNOUNCE_THROTTLE_MS) {
    scheduleTrailingSweep(LIVE_ANNOUNCE_THROTTLE_MS - sinceLast);
    return 0;
  }
  pendingSweep = runLiveAnnouncementSweep().catch((error: unknown) => {
    if (!isMissingTableError(error)) console.error("[live-announce] balayage en échec", error);
    return 0;
  });
  try {
    return await pendingSweep;
  } finally {
    lastSweepAt = Date.now();
    pendingSweep = null;
  }
}

/** Remet l'étranglement à zéro. Réservé aux tests. */
export function resetLiveAnnouncementThrottle(): void {
  lastSweepAt = 0;
  retryNotBefore = 0;
  heldUntil.clear();
  lastWarnAt.clear();
  pendingSweep = null;
  if (trailingTimer) clearTimeout(trailingTimer);
  trailingTimer = null;
}
