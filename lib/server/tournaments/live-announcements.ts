/**
 * Annonce des lives sur Discord : au **début** d'un match diffusé, le bot poste
 * dans le salon #live du serveur BlueGenji le message de la soirée (`@everyone`
 * pour la chaîne officielle, rôle StreamViewer sinon) qui nomme les deux
 * engagés, le tournoi, l'heure, et donne le lien de la diffusion.
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
 * **Un message par soirée et par public, pas par match.** Le premier direct
 * ouvre une soirée de `LIVE_EVENING_WINDOW_HOURS` heures (`bg_live_evenings`)
 * pour son public : la chaîne officielle notifie `@everyone`, toute autre
 * chaîne le seul rôle StreamViewer. Le message liste les matchs de la soirée
 * — à l'antenne, puis programmés, chacun à son heure (Paris). Un match qui
 * passe ensuite à l'antenne dans la fenêtre **modifie** ce message (le bot
 * rend son identifiant), sans nouvelle notification ; si le message a disparu,
 * le bot poste une suite sans mention. Chaque affiche garde sa réservation.
 *
 * **Fraîcheur : deux heures.** Un match n'est annoncé que dans les deux heures
 * qui suivent son passage à l'antenne (`LIVE_ANNOUNCE_MAX_AGE_MINUTES`) : un
 * déploiement, une table recréée ou une longue panne du bot ne réveillent
 * jamais `@everyone` pour un match commencé depuis longtemps.
 *
 * **Production seulement** : une base de développement (seed `Test_`) ne doit
 * jamais faire écrire `@everyone` à 1 200 personnes, même devant un bot local
 * branché par erreur sur le vrai serveur. `NODE_ENV=production` ne suffit pas
 * à le dire — `npm start` le pose aussi sur un poste de développement, et un
 * tunnel (ngrok, Cloudflare) donne à ce poste un vrai nom de domaine en
 * `https` : il faut en plus `LIVE_ANNOUNCEMENTS_ENABLED=1`, que seul le `.env`
 * de production pose, et un `APP_URL` en `https` sur un nom de domaine.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { siteBaseUrl } from "@/lib/server/site-url";
import { isBotCircuitOpen, pushLiveEvening, type LiveAnnouncementOutcome } from "@/lib/server/bot-integration";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import {
  formatLiveEvening,
  LIVE_EVENING_WINDOW_HOURS,
  liveAnnouncementUrl,
  liveMentionTarget,
  type LiveEveningStream,
  type LiveMentionTarget,
} from "@/lib/shared/live-announcements";
import { isMatchLive, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import { parisInstant } from "@/lib/shared/match-start-entry";
import { isSoloTournament, toParticipantType } from "@/lib/shared/participants";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
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
  /** Pseudo public du joueur d'une entrée individuelle (`null` : équipe, ou compte supprimé). */
  team1_pseudo: string | null;
  team2_pseudo: string | null;
  /**
   * Lecture d'une soirée seulement : `1` si le match a déjà une annonce
   * réservée depuis l'ouverture de la soirée (publiée, ou d'issue incertaine).
   */
  evening_announced?: number | string | null;
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

/** Vrai une fois la désactivation signalée dans pm2 (une ligne par processus). */
let disabledNoticeShown = false;

/** Suffixes réservés aux réseaux locaux et aux tests, jamais au site public. */
const LOCAL_SUFFIX = /\.(localhost|test|local|internal|lan|home\.arpa|invalid|example)$/i;

/** Adresse IPv4 écrite en chiffres (`10.0.0.2`, `192.168.1.20`…). */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Vrai si `APP_URL` désigne le site public : `https` sur un **nom de
 * domaine** — ni adresse IP (boucle locale, réseau privé), ni nom d'un seul
 * mot (`localhost`, nom de machine), ni suffixe local ou de test.
 */
function servedUnderPublicName(): boolean {
  const base = siteBaseUrl();
  if (!base) return false;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // `localhost.` (point final) désigne le même hôte que `localhost`.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || IPV4_LITERAL.test(host)) return false;
  return host.includes(".") && !LOCAL_SUFFIX.test(host);
}

/**
 * Vrai si les annonces peuvent partir : en production, sur le site public, et
 * **activées explicitement** (`LIVE_ANNOUNCEMENTS_ENABLED=1`, posée par le seul
 * `.env` de production). Une compilation lancée par `npm start` sur un poste —
 * `APP_URL` locale ou tunnel en `https` — ne poste rien, même devant la base
 * du seed et un bot branché sur le vrai serveur.
 */
export function liveAnnouncementsEnabled(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.LIVE_ANNOUNCEMENTS_ENABLED?.trim() === "1" &&
    servedUnderPublicName()
  );
}

/** Changement de confidentialité qui annonce le pseudo des entrées individuelles dans #live. */
const SOLO_PSEUDO_PRIVACY_CHANGE_ID = "2026-10-pseudo-live-et-messages-de-match";

/**
 * Première date d'inscription dont le pseudo peut partir dans #live : celle de
 * la publication du changement qui l'annonce. Un joueur inscrit avant a lu
 * « un joueur, jamais un pseudo » et ne peut plus « ne pas s'inscrire » : son
 * entrée reste « un joueur » jusqu'au bout du tournoi. Changement introuvable :
 * aucun pseudo ne part.
 *
 * @returns Minuit à Paris du jour de publication, en secondes Unix — comparé à
 *   `UNIX_TIMESTAMP(registered_at)`, qui lit la date dans le fuseau de la
 *   session : le seuil ne dépend pas du fuseau du serveur de base.
 */
export function soloPseudoRegisteredSince(): number | null {
  const change = PRIVACY_CHANGES.find((entry) => entry.id === SOLO_PSEUDO_PRIVACY_CHANGE_ID);
  if (!change) return null;
  const [year, month, day] = change.publishedAt.split("-").map(Number);
  return parisInstant(year, month, day, 0, 0) / 1000;
}

/** Seuil d'un changement introuvable : aucune inscription ne l'atteint (9999-12-31). */
const NEVER_REGISTERED_SINCE = 253_402_300_799;

/**
 * Matchs castés, jouables, d'un tournoi en cours, passés à l'antenne depuis
 * moins de deux heures, dont l'affiche courante n'a pas encore été annoncée. Le passage à l'antenne se décide ensuite **en
 * mémoire** (`isMatchLive`), comme pour le bouton d'accueil : leur nombre est
 * marginal, et aucune requête ne réimplémente la règle en SQL.
 */
async function loadCandidates(): Promise<LiveCandidateRow[]> {
  return selectMatches(
    `m.live_trigger IS NOT NULL AND m.status = 'READY' AND m.is_bye = 0
        AND ${FRESH_ON_AIR_SQL}
        AND NOT EXISTS (SELECT 1 FROM bg_live_announcements a
                         WHERE a.match_id = m.id
                           AND a.pairing = CONCAT(LEAST(m.team1_id, m.team2_id), ':', GREATEST(m.team1_id, m.team2_id)))`,
    [],
  );
}

/**
 * Matchs castés d'une soirée : ceux annoncés depuis son ouverture, et ceux
 * programmés (`START_TIME`) d'ici sa fin — leur heure figure dans le message.
 * Le public (chaîne officielle ou non) se trie ensuite en mémoire.
 */
async function loadEveningMatches(evening: LiveEvening): Promise<LiveCandidateRow[]> {
  const announcedSince = `EXISTS (SELECT 1 FROM bg_live_announcements ea
                                   WHERE ea.match_id = m.id AND ea.sent_at >= ?) AS evening_announced`;
  // Sans message encore gardé, celui-ci est le premier : la fenêtre repartira
  // de son envoi (`rememberEveningMessage`), il liste donc les matchs
  // programmés jusqu'à cette fin-là.
  const until = evening.discord_message_id ? "?" : `GREATEST(?, NOW() + INTERVAL ${LIVE_EVENING_WINDOW_HOURS} HOUR)`;
  return selectMatches(
    `m.live_trigger IS NOT NULL AND m.is_bye = 0
        AND (EXISTS (SELECT 1 FROM bg_live_announcements a WHERE a.match_id = m.id AND a.sent_at >= ?)
             OR (m.live_trigger = 'START_TIME' AND m.status IN ('PENDING', 'READY')
                 AND m.start_at > NOW() AND m.start_at <= ${until}))`,
    [evening.started_at, evening.window_end],
    { column: announcedSince, params: [evening.started_at] },
  );
}

/** Lecture commune des matchs annonçables : affiche, tournoi, pseudos publiables. */
async function selectMatches(
  where: string,
  params: readonly unknown[],
  extra: { column: string; params: readonly unknown[] } | null = null,
): Promise<LiveCandidateRow[]> {
  const db = await getDatabase();
  // Le pseudo n'est lu que pour une inscription faite sous la mention qui
  // l'annonce (`soloPseudoRegisteredSince`) ; sinon `NULL`, « un joueur ».
  const since = soloPseudoRegisteredSince() ?? NEVER_REGISTERED_SINCE;
  const registeredSince = (alias: string) =>
    `EXISTS (SELECT 1 FROM bg_tournament_registrations r WHERE r.tournament_id = m.tournament_id
               AND r.team_id = ${alias}.id AND UNIX_TIMESTAMP(r.registered_at) >= ?)`;
  const [rows] = await db.query<LiveCandidateRow[]>(
    `SELECT m.id, m.tournament_id, t.name AS tournament_name, t.participant_type,
            t.live_url AS tournament_live_url, m.status, m.start_at, m.live_trigger,
            m.live_started_at, m.live_url, m.launched_at, m.launch_pairing,
            CONCAT(m.team1_id, ':', m.team2_id) AS pairing,
            t1.name AS team1_name, t2.name AS team2_name,
            t1.solo_user_id AS team1_solo_user_id, t2.solo_user_id AS team2_solo_user_id,
            u1.pseudo AS team1_pseudo, u2.pseudo AS team2_pseudo${extra ? `, ${extra.column}` : ""}
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
                            AND t.state = 'RUNNING' AND t.start_visibility_at <= NOW()
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
       LEFT JOIN bg_users u1 ON u1.id = t1.solo_user_id AND u1.is_deleted = 0 AND ${registeredSince("t1")}
       LEFT JOIN bg_users u2 ON u2.id = t2.solo_user_id AND u2.is_deleted = 0 AND ${registeredSince("t2")}
      WHERE ${where}
      ORDER BY m.id`,
    [...(extra?.params ?? []), since, since, ...params],
  );
  return rows;
}

/** Soirée d'annonces ouverte pour un public (`bg_live_evenings`). */
interface LiveEvening extends RowDataPacket {
  id: number;
  started_at: Date | string;
  window_end: Date | string;
  discord_message_id: string | null;
  /** `1` : le message gardé est parti sans mention (ses modifications n'en écrivent pas). */
  silent?: number | boolean | null;
}

/** Instant d'une colonne `DATETIME`, en millisecondes ; `null` si vide. */
function instant(value: Date | string | null): number | null {
  const iso = toIso(value);
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * Heure affichée d'un match de la soirée : son passage à l'antenne (lancement
 * en `AUTO`, heure dite en `START_TIME`, ouverture d'antenne en `MANUAL`), ou
 * l'heure prévue d'un match à venir.
 */
function streamTime(row: LiveCandidateRow, now: number): number {
  const launched = row.launch_pairing === row.pairing ? instant(row.launched_at) : null;
  if (row.live_trigger === "MANUAL") return instant(row.live_started_at) ?? now;
  if (row.live_trigger === "AUTO") return launched ?? now;
  const start = instant(row.start_at) ?? now;
  // Devenu jouable après son heure : il passe à l'antenne à son lancement.
  return launched !== null && launched > start ? launched : start;
}

/**
 * Ouvre — ou reprend — la soirée d'un public : la dernière dont la fenêtre
 * ({@link LIVE_EVENING_WINDOW_HOURS} heures depuis le premier direct annoncé)
 * court encore. Les soirées finies depuis un jour sont oubliées au passage.
 */
async function openEvening(target: LiveMentionTarget): Promise<LiveEvening> {
  const db = await getDatabase();
  try {
    await db.execute(`DELETE FROM bg_live_evenings WHERE window_end < NOW() - INTERVAL 1 DAY`);
  } catch {
    // Ménage seulement : réessayé au passage suivant.
  }
  const select = `SELECT id, started_at, window_end, discord_message_id, silent FROM bg_live_evenings
                   WHERE target = ? AND window_end > NOW() ORDER BY id DESC LIMIT 1`;
  const [open] = await db.query<LiveEvening[]>(select, [target]);
  if (open[0]) return open[0];
  await db.execute(
    `INSERT INTO bg_live_evenings (target, started_at, window_end)
     VALUES (?, NOW(), NOW() + INTERVAL ${LIVE_EVENING_WINDOW_HOURS} HOUR)`,
    [target],
  );
  const [created] = await db.query<LiveEvening[]>(select, [target]);
  if (!created[0]) throw new Error("soirée d'annonces introuvable après sa création");
  return created[0];
}

/** Vrai si le message gardé de la soirée est parti sans mention : sa modification n'en écrit pas. */
function editsSilentMessage(evening: LiveEvening): boolean {
  return Boolean(evening.discord_message_id) && Number(evening.silent) === 1;
}

/**
 * Vrai si le bot a posté une suite (message disparu ou plus modifiable) : il
 * rend un autre identifiant que celui à modifier, et la suite part sans mention.
 */
function isFollowUp(evening: LiveEvening, messageId: string | null): boolean {
  return Boolean(evening.discord_message_id) && messageId !== null && messageId !== evening.discord_message_id;
}

/**
 * Garde l'identifiant du message publié (ou de la suite qui le remplace), et
 * s'il est parti sans mention. Le premier message gardé de la soirée fait
 * partir la fenêtre de son envoi : des essais reportés (bot injoignable) ne
 * l'ont pas raccourcie, et elle couvre les matchs programmés qu'il liste.
 */
async function rememberEveningMessage(
  evening: LiveEvening,
  messageId: string | null,
  silent: boolean,
): Promise<void> {
  if (!messageId || messageId === evening.discord_message_id) return;
  const window = !evening.discord_message_id
    ? `, window_end = GREATEST(window_end, NOW() + INTERVAL ${LIVE_EVENING_WINDOW_HOURS} HOUR)`
    : "";
  try {
    const db = await getDatabase();
    await db.execute(`UPDATE bg_live_evenings SET discord_message_id = ?, silent = ?${window} WHERE id = ?`, [
      messageId,
      silent ? 1 : 0,
      Number(evening.id),
    ]);
  } catch (error) {
    // Le prochain match de la soirée partira dans un nouveau message.
    console.error(`[live-announce] soirée ${Number(evening.id)} : identifiant du message non gardé`, error);
  }
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

/**
 * Clé de réservation d'une affiche : ses deux engagés **sans ordre**
 * (`5:7` pour `7:5`). Un plateau réécrit qui remet les deux mêmes engagés dans
 * l'autre ordre sur le même match (`rewrittenPlayoffMatchIds` l'attend) est la
 * même rencontre, déjà annoncée : pas de second `@everyone`.
 */
function announceKey(pairing: string): string {
  const [first, second] = pairing.split(":").map(Number);
  return first <= second ? `${first}:${second}` : `${second}:${first}`;
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
    const params = rows.flatMap((row) => [Number(row.id), announceKey(String(row.pairing))]);
    await db.execute(`DELETE FROM bg_live_announcements WHERE (match_id, pairing) IN (${placeholders})`, params);
    return true;
  } catch (error) {
    const lost = rows.length > 1 ? "annonces non réessayées" : "annonce non réessayée";
    console.error(`[live-announce] ${label} : réservation non rendue, ${lost}`, error);
    return false;
  }
}

/** Matchs réservés par un passage pour un même public (chaîne officielle ou non). */
interface AnnouncementGroup {
  target: LiveMentionTarget;
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
 * Nom public d'un engagé dans l'annonce #live : le nom de l'équipe, ou, pour
 * une entrée individuelle (`solo_user_id`), le **pseudo du compte** — seule
 * exception à la règle « aucun pseudo sur Discord », décidée par l'utilisateur
 * (2026-10-14, `RGPD_LOGS_AND_VISITS.md`). Jamais le nom de l'entrée solo
 * (`bg_teams.name`, qui peut porter un suffixe de dédoublonnage) ; `null` pour
 * un compte supprimé, écrit « un joueur ». En tournoi individuel, une entrée
 * sans compte (invité fantôme, nommé par le staff — souvent un prénom) s'écrit
 * aussi « un joueur » : seul un pseudo de compte peut partir.
 */
export function liveEntrantName(
  soloUserId: number | null,
  teamName: unknown,
  pseudo: unknown,
  participantType: unknown,
): string | null {
  if (soloUserId == null) return isSoloTournament(toParticipantType(participantType)) ? null : String(teamName);
  return typeof pseudo === "string" && pseudo.trim() !== "" ? pseudo : null;
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
  // Le bot est tombé en route : ce que montre #live fait foi.
  interrupted:
    "bot tombé avant sa réponse (connexion coupée, redémarrage ?), annonce peut-être publiée, non réessayée — vérifier #live",
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
  unauthorized:
    "jeton interne refusé ou absent (BOT_INTERNAL_TOKEN du site et INTERNAL_API_TOKEN du bot doivent être réglés et égaux)",
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
  "unauthorized",
  "channel-closed",
  "discord-unreachable",
]);

/** Ce que les traces pm2 et le bot disent d'un groupe : ses matchs et son tournoi. */
function describeGroup(
  group: AnnouncementGroup,
  eveningId?: number,
): { label: string; context: string; plural: boolean } {
  const ids = matchIdsOf(group);
  // Un groupe réunit un public, donc parfois plusieurs tournois : tous sont nommés.
  const tournaments = [...new Set(group.rows.map((row) => Number(row.tournament_id)))];
  const plural = ids.length > 1;
  const noun = plural ? "matchs" : "match";
  const evening = eveningId === undefined ? "" : `soiree-${eveningId} `;
  const tournamentNoun = tournaments.length > 1 ? "tournois" : "tournoi";
  return {
    label: `${noun} ${ids.join(", ")} (${tournamentNoun} ${tournaments.join(", ")})`,
    // Le tournoi en tête : le staff ouvre `/tournois/<id>` depuis le canal de logs.
    context: `live-announce ${evening}tournoi-${contextIds(tournaments)} match-${contextIds(ids)}`,
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
async function postpone(group: AnnouncementGroup, outcome: PostponedOutcome, eveningId?: number): Promise<void> {
  if (SHARED_POSTPONEMENTS.has(outcome)) postponeRetries();
  else holdGroup(group);
  const { label, context, plural } = describeGroup(group, eveningId);
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
/**
 * Matchs d'une soirée pour le public du groupe : les matchs réservés par ce
 * passage (même si leur trace date d'avant l'ouverture de la soirée), puis
 * ceux déjà annoncés ou programmés d'ici la fin de la fenêtre, sur une chaîne
 * du même public.
 */
function eveningStreams(
  group: AnnouncementGroup,
  others: readonly LiveCandidateRow[],
  now: number,
): { row: LiveCandidateRow; url: string; live: boolean; at: number }[] {
  const seen = new Set<number>();
  const streams: { row: LiveCandidateRow; url: string; live: boolean; at: number }[] = [];
  for (const row of [...group.rows, ...others]) {
    const id = Number(row.id);
    if (seen.has(id)) continue;
    const url = liveAnnouncementUrl(row.live_url, row.tournament_live_url);
    if (!url || liveMentionTarget(url) !== group.target) continue;
    seen.add(id);
    const live = isOnAir(row, now);
    const at = streamTime(row, now);
    // Un match fini, ou repoussé hors de la soirée, n'y figure plus.
    if (!live && (row.status !== "PENDING" && row.status !== "READY")) continue;
    streams.push({ row, url, live, at });
  }
  return streams;
}

/**
 * Vrai si un match de la soirée, hors du groupe et du même public, a déjà une
 * annonce réservée depuis son ouverture : une notification a pu partir.
 */
function alreadyAnnounced(group: AnnouncementGroup, others: readonly LiveCandidateRow[]): boolean {
  const claimed = new Set(group.rows.map((row) => Number(row.id)));
  return others.some((row) => {
    if (claimed.has(Number(row.id)) || Number(row.evening_announced) !== 1) return false;
    const url = liveAnnouncementUrl(row.live_url, row.tournament_live_url);
    return url !== null && liveMentionTarget(url) === group.target;
  });
}

/**
 * Un engagé d'une ligne de soirée : un tournoi qui compte une entrée
 * individuelle est un tournoi individuel, même au type illisible — son invité
 * sans compte ne part pas sous son nom.
 */
function eveningEntrant(row: LiveCandidateRow, side: 1 | 2, withPseudo: boolean): string | null {
  const solo = row.team1_solo_user_id != null || row.team2_solo_user_id != null;
  const participantType = solo ? "SOLO" : row.participant_type;
  if (side === 1) {
    const pseudo = withPseudo ? row.team1_pseudo : null;
    return liveEntrantName(row.team1_solo_user_id, row.team1_name, pseudo, participantType);
  }
  const pseudo = withPseudo ? row.team2_pseudo : null;
  return liveEntrantName(row.team2_solo_user_id, row.team2_name, pseudo, participantType);
}

/**
 * Annonce un groupe réservé : ouvre ou reprend la soirée de son public, puis
 * publie le message de la soirée (premier direct : notification) ou le modifie
 * (matchs suivants : aucune nouvelle notification).
 *
 * @returns Le nombre de matchs publiés, et l'issue si l'annonce est reportée.
 */
async function announce(
  group: AnnouncementGroup,
  now: number,
): Promise<{ posted: number; postponed: PostponedOutcome | null }> {
  let evening: LiveEvening;
  let others: LiveCandidateRow[];
  try {
    evening = await openEvening(group.target);
    others = await loadEveningMatches(evening);
  } catch (error) {
    // La base est en cause, pas le bot : seul ce public attend (l'autre est
    // essayé), et pm2 ne parle pas d'un bot injoignable.
    warnOnce(`evening ${group.target}`, `[live-announce] soirée ${group.target} illisible, annonce reportée`, error);
    holdGroup(group);
    await releaseAnnouncements(group.rows, describeGroup(group).label);
    return { posted: 0, postponed: null };
  }
  const streams = eveningStreams(group, others, now);
  // Soirée sans message connu, mais dont un autre match a déjà une annonce
  // (issue incertaine, bot trop ancien, identifiant non gardé) : son public a
  // peut-être déjà été notifié — un nouveau message part, sans notification.
  const quiet = !evening.discord_message_id && alreadyAnnounced(group, others);
  // `withPseudo: false` : ce que le bot cite à son canal de logs si l'annonce
  // échoue — le même texte, pseudos ôtés : l'exception vaut pour #live seulement.
  const text = (withPseudo: boolean) =>
    formatLiveEvening(
      streams.map(
        ({ row, url, live, at }): LiveEveningStream => ({
          startsAt: at,
          live,
          tournamentName: String(row.tournament_name),
          team1Name: eveningEntrant(row, 1, withPseudo),
          team2Name: eveningEntrant(row, 2, withPseudo),
          url,
        }),
      ),
    );
  const { text: message, urls } = text(true);
  const { text: logMessage } = text(false);
  const { label, context, plural } = describeGroup(group, Number(evening.id));
  const { outcome, messageId } = await pushLiveEvening({
    message,
    streamUrls: urls,
    mention: group.target,
    context,
    ...(logMessage === message ? {} : { logMessage }),
    ...(evening.discord_message_id ? { editMessageId: String(evening.discord_message_id) } : {}),
    ...(quiet || editsSilentMessage(evening) ? { notify: false as const } : {}),
  });
  if (outcome === "posted" || outcome === "posted-silent") {
    await rememberEveningMessage(evening, messageId, quiet || outcome === "posted-silent" || isFollowUp(evening, messageId));
    // Trace pm2 pour le staff : identifiants seulement, aucun nom.
    const silent = outcome === "posted-silent" ? " sans notifier (permission de mentionner absente)" : "";
    const announced = plural ? "annoncés" : "annoncé";
    let how = "dans un nouveau message";
    if (evening.discord_message_id) how = "ajoutés au message de la soirée";
    else if (quiet) how = "dans un nouveau message sans notifier, la soirée ayant déjà une annonce";
    console.info(`[live-announce] ${label} ${announced} dans #live (soirée ${Number(evening.id)}, ${how})${silent}`);
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
  await postpone(group, postponed, Number(evening.id));
  return { posted: 0, postponed };
}

/**
 * Réserve l'affiche d'un match ; `false` si un autre passage l'a prise ou si
 * la base a refusé. Une réservation refusée (verrou, panne) ne doit pas
 * emporter les affiches déjà réservées de ce passage : elles partent.
 */
async function tryClaim(row: LiveCandidateRow): Promise<boolean> {
  try {
    return await claimAnnouncement(Number(row.id), announceKey(String(row.pairing)));
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
    if (!isOnAir(row, now)) continue;
    // Pas de lien exploitable, pas d'annonce : il n'y aurait rien à regarder.
    const url = liveAnnouncementUrl(row.live_url, row.tournament_live_url);
    if (!url) {
      warnOnce(
        `no-link ${Number(row.id)}`,
        `[live-announce] match ${Number(row.id)} (tournoi ${Number(row.tournament_id)}) à l'antenne sans lien de diffusion exploitable (ni le match ni le tournoi) : pas d'annonce pour l'instant — un lien ajouté dans les deux heures qui suivent le début du direct la fera partir, ne pas la poster à la main`,
      );
      continue;
    }
    const target = liveMentionTarget(url);
    // Soirée refusée par Discord il y a moins d'une minute : elle attend, et
    // tout match qui la rejoint attend avec elle (une seule notification).
    if (isHeld(target)) continue;
    // Bot en panne : ne rien réserver qu'on sait ne pas pouvoir envoyer.
    if (isBotCircuitOpen()) break;
    if (!(await tryClaim(row))) continue;
    const group = groups.get(target);
    if (group) group.rows.push(row);
    else groups.set(target, { target, rows: [row] });
  }
  return announceGroups(groups.values(), now);
}


/**
 * Annonce les groupes l'un après l'autre. Un report qui tient au bot ou au
 * salon vaut pour les suivants du passage : ils sont rendus sans appel, au
 * lieu d'essuyer le même refus.
 *
 * @returns Le nombre de matchs publiés.
 */
async function announceGroups(groups: Iterable<AnnouncementGroup>, now: number): Promise<number> {
  let posted = 0;
  let postponed: PostponedOutcome | null = null;
  for (const group of groups) {
    if (postponed) {
      await postpone(group, postponed);
      continue;
    }
    const result = await announce(group, now);
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

/**
 * Publics (`everyone`, `stream-viewer`) dont l'annonce de soirée a été refusée
 * par Discord, ou dont la soirée est illisible, et l'instant de leur prochain
 * essai. Par public et non par match : un match de ce public lancé pendant la
 * pause attend avec les autres, et tous partent dans le message de la soirée.
 */
const heldUntil = new Map<string, number>();

/** Met en pause la seule soirée (le public) d'un groupe refusé. */
function holdGroup(group: AnnouncementGroup): void {
  const now = Date.now();
  // Une pause échue s'oublie ici.
  for (const [key, at] of heldUntil) if (at <= now) heldUntil.delete(key);
  heldUntil.set(group.target, now + LIVE_ANNOUNCE_RETRY_DELAY_MS);
  scheduleTrailingSweep(LIVE_ANNOUNCE_RETRY_DELAY_MS);
}

/**
 * Vrai si le public attend encore son prochain essai : la relève est alors
 * programmée à son terme, pour qu'il ne dépende pas d'un prochain évènement.
 * Oublie une pause échue.
 */
function isHeld(key: string): boolean {
  const until = heldUntil.get(key);
  if (until === undefined) return false;
  const left = until - Date.now();
  if (left > 0) {
    scheduleTrailingSweep(left);
    return true;
  }
  heldUntil.delete(key);
  return false;
}

/** Reporte le prochain balayage d'une {@link LIVE_ANNOUNCE_RETRY_DELAY_MS}. */
function postponeRetries(): void {
  retryNotBefore = Date.now() + LIVE_ANNOUNCE_RETRY_DELAY_MS;
  // L'essai suivant tombe à son terme, même sans nouvel évènement.
  scheduleTrailingSweep(LIVE_ANNOUNCE_RETRY_DELAY_MS);
}

let lastSweepAt = 0;
let pendingSweep: Promise<number> | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
/** Instant visé par `trailingTimer`. */
let trailingAt = 0;

/**
 * Relève : un appel étranglé, ou arrivé pendant un passage dont la lecture a
 * pu précéder le passage à l'antenne, ne doit pas être perdu. Une seule
 * relève, à l'échéance **la plus proche** : la fin d'une pause d'une minute ne
 * repousse pas celle, à dix secondes, d'un autre tournoi.
 */
function scheduleTrailingSweep(delayMs: number): void {
  const at = Date.now() + Math.max(0, delayMs);
  if (trailingTimer) {
    if (trailingAt <= at) return;
    clearTimeout(trailingTimer);
  }
  trailingAt = at;
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    // Une échéance plus lointaine a pu céder la place à celle-ci : elle est
    // reprogrammée, même si ce passage n'a rien lu (coupe-circuit, panne).
    void dispatchLiveAnnouncements().finally(rearmPendingRetries);
  }, Math.max(0, delayMs));
  trailingTimer.unref?.();
}

/** Reprogramme la relève sur la prochaine fin de pause à venir (processus ou diffusion). */
function rearmPendingRetries(): void {
  const now = Date.now();
  let next = retryNotBefore > now ? retryNotBefore : Number.POSITIVE_INFINITY;
  for (const at of heldUntil.values()) if (at > now && at < next) next = at;
  if (Number.isFinite(next)) scheduleTrailingSweep(next - now);
}

/**
 * Annonce les lives dus. Jamais bloquant, jamais une exception : l'appelant
 * est une écriture déjà faite ou une lecture de page.
 *
 * @returns Le nombre d'annonces publiées (0 si étranglé ou désactivé).
 */
export async function dispatchLiveAnnouncements(): Promise<number> {
  if (!liveAnnouncementsEnabled()) {
    // En production, une variable oubliée au déploiement se lit dans pm2.
    if (process.env.NODE_ENV === "production" && !disabledNoticeShown) {
      disabledNoticeShown = true;
      console.info(
        "[live-announce] annonces de live désactivées : LIVE_ANNOUNCEMENTS_ENABLED=1 et un APP_URL https public sont requis",
      );
    }
    return 0;
  }
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
  disabledNoticeShown = false;
  heldUntil.clear();
  lastWarnAt.clear();
  pendingSweep = null;
  if (trailingTimer) clearTimeout(trailingTimer);
  trailingTimer = null;
}
