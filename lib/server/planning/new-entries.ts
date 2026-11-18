/**
 * Récapitulatif des nouvelles entrées du planning (`PLANNING_NEW_ENTRIES`,
 * `docs/features/CAST_PLANNING.md` § Notifications).
 *
 * Un balayage périodique (chaque minute) note chaque entrée ouverte qu'il
 * découvre (`bg_planning_entry_notices`). Une **vague** de planification — un
 * tableau généré, dix matchs planifiés coup sur coup — s'annonce en **un seul**
 * message : on attend que la vague se calme ({@link NEW_ENTRIES_QUIET_MS} sans
 * nouvelle entrée), sans jamais attendre plus de {@link NEW_ENTRIES_MAX_WAIT_MS}
 * depuis la plus ancienne. Chaque membre ne reçoit que les entrées où il tient
 * un rôle utile : arbitre seulement s'il remplit la condition d'arbitrage du
 * jeu, jamais une entrée où il joue. Les membres qui reçoivent la même liste
 * partent en un envoi.
 *
 * Une entrée d'un tournoi encore caché n'est pas notée : elle le sera quand
 * le tournoi deviendra visible, et partira alors à tous ceux qu'elle concerne
 * (l'annoncer plus tôt au seul staff qui voit les tournois cachés la ferait
 * passer pour annoncée aux autres, qui n'en sauraient jamais rien).
 *
 * Au tout premier passage (marqueur {@link BOOTSTRAP_SETTING} absent de
 * `bg_settings` : premier déploiement), tout ce qui existe est noté **déjà
 * annoncé** : on n'écrit pas en masse sur un planning qui n'est pas nouveau.
 * Le marqueur, posé une fois, ne dépend pas du contenu de la table, que la
 * purge de conservation peut vider. Les entrées sont notées annoncées
 * **avant** l'envoi : une panne fait perdre un récapitulatif, jamais en envoyer deux.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { formatPlanningNewEntriesDm, type PlanningNoticeEntry } from "@/lib/shared/planning-notices";
import { planningNewEntriesPush } from "@/lib/shared/push-messages";
import { loadPlanningEntries, loadPlanningMembers, type Executor, type LoadedEntry, type LoadedMember } from "./load";
import { noticeEntry } from "./notices";
import { loadEntryPlayers, playersDuring } from "./players";

/** Sans nouvelle entrée depuis ce délai, la vague est close : on l'annonce. */
export const NEW_ENTRIES_QUIET_MS = 5 * 60 * 1000;
/** Une vague qui ne se calme pas s'annonce tout de même au bout de ce délai. */
export const NEW_ENTRIES_MAX_WAIT_MS = 30 * 60 * 1000;
const SWEEP_TICK_MS = 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const NOTICES_LOCK = "bg_planning_notices";
/** Marqueur (`bg_settings`) du premier passage, posé une fois pour toutes. */
export const BOOTSTRAP_SETTING = "planning_entry_notices_bootstrapped";

type NoticeRow = RowDataPacket & { entry_key: string; seen_at: Date | string; announced_at: Date | string | null };

/** La vague est-elle à annoncer : calme depuis {@link NEW_ENTRIES_QUIET_MS}, ou ouverte depuis {@link NEW_ENTRIES_MAX_WAIT_MS} ? */
export function waveReady(seenAt: readonly number[], now: number): boolean {
  if (seenAt.length === 0) return false;
  const newest = Math.max(...seenAt);
  const oldest = Math.min(...seenAt);
  return now - newest >= NEW_ENTRIES_QUIET_MS || now - oldest >= NEW_ENTRIES_MAX_WAIT_MS;
}

/**
 * Qui reçoit quoi : pour chaque membre, les entrées de la vague où il tient un
 * rôle utile (voir l'en-tête). `eligibleReferees` : par jeu, les arbitres qui
 * remplissent la condition d'arbitrage ; `players` : qui joue pendant chaque entrée.
 */
export function digestRecipients(
  entries: readonly LoadedEntry[],
  members: readonly LoadedMember[],
  eligibleReferees: ReadonlyMap<string, ReadonlySet<number>>,
  playersOf: (entry: LoadedEntry) => ReadonlySet<number>,
): Map<number, LoadedEntry[]> {
  const out = new Map<number, LoadedEntry[]>();
  for (const entry of entries) {
    const players = playersOf(entry);
    for (const member of members) {
      if (entry.hidden && !member.seesHidden) continue;
      if (players.has(member.userId)) continue;
      const referee = member.roles.includes("REFEREE") && (eligibleReferees.get(entry.game)?.has(member.userId) ?? false);
      const streams = member.roles.includes("CASTER") || member.roles.includes("PROD");
      if (!referee && !streams) continue;
      const list = out.get(member.userId) ?? [];
      list.push(entry);
      out.set(member.userId, list);
    }
  }
  return out;
}

/** Membres regroupés par liste identique d'entrées : un envoi par liste. */
export function groupByEntries(byMember: ReadonlyMap<number, readonly LoadedEntry[]>): { userIds: number[]; entries: LoadedEntry[] }[] {
  const groups = new Map<string, { userIds: number[]; entries: LoadedEntry[] }>();
  for (const [userId, entries] of byMember) {
    const sorted = [...entries].sort((a, b) => a.startAt - b.startAt || a.key.localeCompare(b.key));
    const signature = sorted.map((entry) => entry.key).join(",");
    const group = groups.get(signature) ?? { userIds: [], entries: sorted };
    group.userIds.push(userId);
    groups.set(signature, group);
  }
  return [...groups.values()];
}

async function eligibleByGame(executor: Executor, members: readonly LoadedMember[], entries: readonly LoadedEntry[]) {
  const referees = members.filter((member) => member.roles.includes("REFEREE")).map((member) => member.userId);
  const out = new Map<string, Set<number>>();
  for (const game of new Set(entries.map((entry) => entry.game))) {
    out.set(game, referees.length === 0 ? new Set() : await loadEligibleRefereeIds(executor, referees, game));
  }
  return out;
}

const toMs = (value: Date | string) => new Date(value).getTime();
const inList = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/** Le premier passage a-t-il déjà eu lieu ({@link BOOTSTRAP_SETTING}) ? */
async function bootstrapped(connection: PoolConnection): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT 1 FROM bg_settings WHERE setting_key = ? LIMIT 1", [BOOTSTRAP_SETTING]);
  return rows.length > 0;
}

/**
 * Un passage : note les entrées nouvelles, et rend la vague à annoncer (déjà
 * notée annoncée) — vide si rien n'est prêt. Sous le verrou nommé : deux
 * processus ne l'annoncent jamais deux fois. Ne lit que les lignes utiles :
 * celles des entrées ouvertes, et celles qui attendent leur annonce.
 */
export async function collectWave(connection: PoolConnection, now: number): Promise<LoadedEntry[]> {
  // Un tournoi caché attend d'être visible (voir l'en-tête).
  const entries = (await loadPlanningEntries(connection, { now, includeHidden: true })).filter((entry) => entry.open && !entry.hidden);
  const bootstrap = !(await bootstrapped(connection));
  const openKeys = entries.map((entry) => entry.key);
  const [known] = await connection.execute<NoticeRow[]>(
    openKeys.length === 0
      ? `SELECT entry_key, seen_at, announced_at FROM bg_planning_entry_notices WHERE announced_at IS NULL`
      : `SELECT entry_key, seen_at, announced_at FROM bg_planning_entry_notices
          WHERE announced_at IS NULL OR entry_key IN (${inList(openKeys.length)})`,
    openKeys,
  );
  const knownKeys = new Set(known.map((row) => row.entry_key));
  const fresh = entries.filter((entry) => !knownKeys.has(entry.key));
  const stamp = new Date(now);
  if (fresh.length > 0) {
    await connection.execute(
      `INSERT IGNORE INTO bg_planning_entry_notices (entry_key, tournament_id, match_id, seen_at, announced_at)
       VALUES ${fresh.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
      fresh.flatMap((entry) => [entry.key, entry.tournamentId, entry.matchId, stamp, bootstrap ? stamp : null]),
    );
  }
  if (bootstrap) {
    await connection.execute("INSERT IGNORE INTO bg_settings (setting_key, setting_value) VALUES (?, '1')", [BOOTSTRAP_SETTING]);
    return [];
  }
  const open = new Map(entries.map((entry) => [entry.key, entry]));
  const pending = [
    ...known.filter((row) => row.announced_at === null).map((row) => ({ key: row.entry_key, seenAt: toMs(row.seen_at) })),
    ...fresh.map((entry) => ({ key: entry.key, seenAt: now })),
  ];
  if (pending.length === 0 || !waveReady(pending.map((row) => row.seenAt), now)) return [];
  // Notées annoncées avant l'envoi ; une entrée partie entre-temps (match déprogrammé, commencé) l'est aussi, sans message.
  const keys = pending.map((row) => row.key);
  await connection.execute(
    `UPDATE bg_planning_entry_notices SET announced_at = ? WHERE announced_at IS NULL AND entry_key IN (${inList(keys.length)})`,
    [stamp, ...keys],
  );
  return keys.flatMap((key) => {
    const entry = open.get(key);
    return entry ? [entry] : [];
  });
}

/** Envoie le récapitulatif d'une vague ; ne lève jamais. */
export async function announceWave(executor: Executor, wave: readonly LoadedEntry[]): Promise<void> {
  if (wave.length === 0) return;
  try {
    const members = await loadPlanningMembers(executor);
    const eligible = await eligibleByGame(executor, members, wave);
    const players = await loadEntryPlayers(executor, wave);
    const byMember = digestRecipients(wave, members, eligible, (entry) => playersDuring(entry, wave, players));
    const base = siteCanonicalBase();
    for (const group of groupByEntries(byMember)) {
      const list: PlanningNoticeEntry[] = group.entries.map(noticeEntry);
      const recipients = await loadNotificationRecipients(group.userIds, "proven");
      await notifyUsers(recipients, {
        topic: "PLANNING_NEW_ENTRIES",
        push: (locale) => planningNewEntriesPush(list, locale),
        discord: { message: (locale) => formatPlanningNewEntriesDm(list, base, locale), context: "planning-new-entries" },
        dmFollowsTopic: true,
      });
    }
  } catch (error) {
    console.error("[planning] récapitulatif des nouvelles entrées impossible.", failureReason(error));
  }
}

/** Un passage complet : la vague sous le verrou, l'envoi après. Rend le nombre d'entrées annoncées. */
export async function sweepNewEntries(now: number = Date.now()): Promise<number> {
  const db = await getDatabase();
  let wave: LoadedEntry[];
  try {
    wave = await withNamedLock(db, NOTICES_LOCK, 0, (connection) => collectWave(connection, now));
  } catch (error) {
    // Un autre processus balaie : il annoncera.
    if (error instanceof NamedLockUnavailableError) return 0;
    throw error;
  }
  await announceWave(db, wave);
  return wave.length;
}

type ClockState = { timer: ReturnType<typeof setInterval> | null; failing: boolean; running: boolean };
const globalClock = globalThis as typeof globalThis & { __bgPlanningNotices?: ClockState };

async function sweepOnce(state: ClockState): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await sweepNewEntries();
    state.failing = false;
  } catch (error) {
    if (!state.failing) console.error("[planning] Balayage des nouvelles entrées impossible.", failureReason(error));
    state.failing = true;
  } finally {
    state.running = false;
  }
}

/** Lance le balayage des nouvelles entrées (une fois par processus). */
export function startPlanningNoticesClock(): void {
  const state = (globalClock.__bgPlanningNotices ??= { timer: null, failing: false, running: false });
  if (state.timer) return;
  const first = setTimeout(() => void sweepOnce(state), FIRST_SWEEP_DELAY_MS);
  first.unref?.();
  state.timer = setInterval(() => void sweepOnce(state), SWEEP_TICK_MS);
  state.timer.unref?.();
}
