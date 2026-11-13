/**
 * Pseudo de l'arbitre désigné d'un match, **pour les membres connectés**
 * (décision 52, `docs/features/MATCH_REFEREE.md` § « Ce que chacun voit »).
 *
 * L'instantané partagé ne nomme personne : il porte, par match, une
 * **empreinte opaque** de la désignation (`refereeKey`) — qui change quand
 * l'arbitre change **ou se renomme**, sans désigner aucun compte — et le
 * contexte du lecteur (`TournamentViewerContext.refereeNames`, servi par le flux
 * **et** par la lecture REST de secours, toutes deux réservées aux comptes)
 * porte les pseudos avec la même empreinte. La page sans compte
 * (`spectatorSnapshot`, `SPECTATOR_VIEWER_CONTEXT`) n'a ni l'une ni l'autre :
 * elle lit « Arbitre désigné ».
 *
 * L'empreinte est un HMAC du match, du compte et de son pseudo, sous un secret
 * **stable** dérivé de la configuration (`refereeKeySecret`) : elle n'est pas la
 * même d'un match à l'autre pour un même arbitre, ne se remonte pas jusqu'au
 * compte, et survit à un redémarrage (un déploiement ne change pas la version
 * de tous les instantanés arbitrés).
 */
import { createHmac, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { cached, invalidateCached, invalidateCachedPrefix } from "@/lib/server/cache";
import { withConnection } from "@/lib/server/database";
import { visibleText } from "@/lib/shared/visible-text";
import { showsRefereeName } from "@/lib/shared/match-referee";
import { castBeforeLaunch } from "@/lib/shared/match-launch";
import type { MatchRefereeName, MatchStatus, TournamentCard, TournamentGame, TournamentSnapshot } from "@/lib/shared/types";
import { refereeEligibilityBlock, type CastEligibilityFields } from "./cast-eligibility";
import { playsMatchSql } from "./match-players";

/**
 * Secret des empreintes : dérivé (HMAC, étiquette propre) du sel des visites
 * ou, à défaut, du secret partagé avec le bot — jamais l'un d'eux tel quel.
 * Stable d'un démarrage à l'autre. Sans l'un ni l'autre (poste de dev, tests),
 * un secret tiré au hasard : une constante connue laisserait retrouver
 * l'arbitre d'un match en énumérant les comptes.
 */
export function refereeKeySecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  const base = env.VISIT_HASH_SALT?.trim() || env.BOT_INTERNAL_TOKEN?.trim();
  if (!base) return randomBytes(32);
  return createHmac("sha256", base).update("bg-referee-key:v1").digest();
}

/**
 * Secret tenu sur `globalThis` : une seconde évaluation du module (rechargement
 * à chaud, double bundle) garde celui des empreintes déjà mises en cache.
 */
const holder = globalThis as typeof globalThis & { __bgRefereeKeySecret?: Buffer };
holder.__bgRefereeKeySecret ??= refereeKeySecret();
const KEY_SECRET = holder.__bgRefereeKeySecret;

/** Longueur de l'empreinte (base64url) : 96 bits, assez pour ne jamais se répéter sur un plateau. */
const REFEREE_KEY_LENGTH = 16;

/**
 * Empreinte opaque de la désignation de `refereeUserId` sur `matchId`. Le
 * pseudo (tel qu'en base) y entre : un arbitre renommé change l'empreinte, donc
 * la version de l'instantané, et les membres relisent son nouveau pseudo.
 */
export function refereeKey(matchId: number, refereeUserId: number, pseudo: string): string {
  return createHmac("sha256", KEY_SECRET)
    .update(`${matchId}:${refereeUserId}:${pseudo}`)
    .digest("base64url")
    .slice(0, REFEREE_KEY_LENGTH);
}

/** Ce que la règle de l'arbitre retenu lit d'une ligne de match. */
export type RefereeKeptRow = {
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  launch_pairing?: string | null;
  launched_at?: Date | null;
  referee_user_id?: number | null;
  referee_discord_verified_at?: Date | null;
  referee_discord_pseudo?: string | null;
  referee_blizzard_sub?: string | null;
  referee_overwatch_battletag_typed?: number | null;
  referee_overwatch_battletag?: string | null;
  referee_is_deleted?: number | null;
  referee_is_admin?: number | null;
  referee_platform_roles_json?: unknown;
  referee_objection_at?: Date | string | null;
  referee_plays_match?: number | null;
};

/**
 * L'arbitre désigné compte-t-il encore ? Il remplit la condition d'arbitrage
 * (relue sur la jointure de l'instantané) et, sur un match à jouer, n'a pas
 * d'opposition retenue ; sinon l'instantané le tait, comme
 * un caster inéligible, et la lecture de la modale le retire avant le lancement.
 */
export function refereeKept(row: RefereeKeptRow, game: TournamentGame): boolean {
  if (row.referee_user_id === null || row.referee_user_id === undefined) return false;
  // Avant le départ, l'arbitre qui joue désormais le match ne compte plus — la
  // même règle que le verrou du lancement (`lockLaunchMatch`).
  const beforeStart = castBeforeLaunch({
    ...row,
    launch_pairing: row.launch_pairing ?? null,
    launched_at: row.launched_at ?? null,
  });
  if (beforeStart && Number(row.referee_plays_match ?? 0) === 1) return false;
  // Opposition retenue : plus montré sur un match à jouer, même si un retrait
  // en série l'a manqué (un match joué garde son arbitre, comme en base).
  if (row.status !== "COMPLETED" && (row.referee_objection_at ?? null) !== null) return false;
  const eligibility: CastEligibilityFields = {
    discord_verified_at: row.referee_discord_verified_at ?? null,
    discord_pseudo: row.referee_discord_pseudo ?? null,
    blizzard_sub: row.referee_blizzard_sub ?? null,
    overwatch_battletag: row.referee_overwatch_battletag ?? null,
    overwatch_battletag_typed: row.referee_overwatch_battletag_typed ?? null,
    is_deleted: Number(row.referee_is_deleted ?? 1),
    is_admin: Number(row.referee_is_admin ?? 0),
    platform_roles_json: row.referee_platform_roles_json ?? null,
  };
  return refereeEligibilityBlock(eligibility, game) === null;
}

/**
 * Matchs d'un tournoi terminé, sans empreinte d'arbitre **là où elle nommerait
 * l'arbitre** (`showsRefereeName` : match resté non joué — reset de grande
 * finale inutile, fin forcée) : un tournoi fini ne nomme plus personne aux
 * membres. Un match resté en attente de confirmation garde la sienne : elle ne
 * nomme personne, et la fenêtre « Contacts » s'y relit quand l'arbitre change.
 * Garde la même référence si rien ne change.
 */
export function withoutRefereeKeys<T extends { id: number; refereeKey: string | null; status: MatchStatus }>(matches: T[]): T[] {
  if (!matches.some(showsRefereeName)) return matches;
  return matches.map((match) => (showsRefereeName(match) ? { ...match, refereeKey: null } : match));
}

/** Une désignation montrée, lue avec son arbitre — **jamais** servie telle quelle (`refereeUserId`). */
export type RefereeDesignation = { matchId: number; refereeKey: string; pseudo: string; refereeUserId: number };

/**
 * Pseudos d'arbitre d'un tournoi, lus une fois pour tous les membres : la liste
 * commune (`names`, pseudos lisibles seulement) et les désignations
 * (`designations`, pseudo vide compris) d'où la marque du lecteur se pose sans
 * aucun calcul d'empreinte.
 */
export type RefereeNamesRead = { names: MatchRefereeName[]; designations: RefereeDesignation[] };

/** Aucune désignation montrée. */
export const NO_REFEREE_NAMES: RefereeNamesRead = { names: [], designations: [] };

/** Le lecteur arbitre-t-il un des matchs montrés ? Une comparaison d'entiers par désignation. */
export function viewerDesignated(read: RefereeNamesRead, viewerUserId: number): boolean {
  return read.designations.some((designation) => designation.refereeUserId === viewerUserId);
}

/**
 * Marque (`mine`) les désignations dont le lecteur est l'arbitre : la liste
 * lue est commune à tous les membres (mise en cache), la marque se pose après,
 * par lecteur — elle ne nomme personne de plus, seulement le lecteur à lui-même.
 *
 * `eligible` : le lecteur remplit **en ce moment** la condition d'arbitrage
 * (permission `tournaments`, identité ; `refereeBlockReason`) — l'instantané en
 * cache peut retarder sur une permission retirée, et les contrôles de
 * l'arbitre ne mèneraient alors qu'à un refus du serveur.
 *
 * La marque ne dépend pas du pseudo : un arbitre dont le pseudo ne s'affiche
 * pas (`visibleText` vide, absent de la liste commune) reçoit une entrée
 * **sans pseudo** (`""`, lue « Arbitre désigné » : `refereeNameOf`) — sans quoi
 * la médiation que le serveur lui accorde n'aurait aucun bouton.
 * Rend la liste commune elle-même si rien n'est marqué.
 */
export function markViewerReferee(read: RefereeNamesRead, viewerUserId: number, eligible: boolean): MatchRefereeName[] {
  if (!eligible || !viewerDesignated(read, viewerUserId)) return read.names;
  const out: MatchRefereeName[] = [];
  for (const { matchId, refereeKey: key, pseudo, refereeUserId } of read.designations) {
    if (refereeUserId === viewerUserId) out.push({ matchId, refereeKey: key, pseudo, mine: true });
    else if (pseudo !== "") out.push({ matchId, refereeKey: key, pseudo });
  }
  return out;
}

/** Les désignations lues, avec leur liste commune (pseudos lisibles seulement). */
function readOf(designations: RefereeDesignation[]): RefereeNamesRead {
  const names = designations
    .filter((designation) => designation.pseudo !== "")
    .map(({ matchId, refereeKey: key, pseudo }): MatchRefereeName => ({ matchId, refereeKey: key, pseudo }));
  return { names, designations };
}

/**
 * Durée de vie des pseudos lus pour une version d'instantané : la clé porte la
 * version, toute écriture en fait une autre ; la durée absorbe les ouvertures
 * de flux (tous les membres lisent les mêmes pseudos) sans tenir plus d'une
 * demi-minute un pseudo changé depuis.
 */
const REFEREE_NAMES_TTL_MS = 30_000;

/** Préfixe des clés de cache des pseudos d'arbitre (`loadRefereeNames`, `loadLiveRefereeNames`). */
const REFEREE_NAMES_CACHE_PREFIX = "referee-names:";

/** Clé de la lecture directe d'un tournoi (`loadLiveRefereeNames`), oubliée à chaque écriture du tournoi. */
function liveCacheKey(tournamentId: number): string {
  return `${REFEREE_NAMES_CACHE_PREFIX}${tournamentId}:live`;
}

/**
 * Oublie la lecture directe des pseudos d'un tournoi : appelée avec
 * l'instantané (`invalidateTournamentSnapshot`), toute écriture qui peut
 * changer une désignation la vide aussi.
 */
export function forgetLiveRefereeNames(tournamentId: number): void {
  invalidateCached(liveCacheKey(tournamentId));
}

/**
 * Oublie tous les pseudos d'arbitre en cache. Un geste qui retire un nom sans
 * forcément changer la version d'un instantané — opposition retenue (son
 * balayage peut échouer en partie), compte supprimé — l'appelle : le pseudo
 * ne reste pas servi jusqu'à l'échéance du cache.
 */
export function forgetRefereeNames(): void {
  invalidateCachedPrefix(REFEREE_NAMES_CACHE_PREFIX);
}

/**
 * Un compte s'est renommé : les tournois où il arbitre un match dont le nom se
 * montre (score pas encore déclaré, `showsRefereeName`) oublient leurs pseudos
 * **et republient leur instantané** — l'empreinte, qui porte le pseudo, change,
 * et les membres déjà connectés relisent le nouveau. Un joueur qui se renomme
 * ne touche rien. Une lecture indexée (`idx_bg_matches_referee`) ; si elle
 * échoue, tout le cache des pseudos est oublié — un ancien pseudo n'est jamais
 * servi faute de l'avoir lue. Ne lève jamais.
 */
export async function forgetRefereeNamesOf(userId: number): Promise<void> {
  let tournamentIds: number[];
  try {
    tournamentIds = await withConnection(async (connection) => {
      const [found] = await connection.query<RowDataPacket[]>(
        `SELECT DISTINCT tournament_id FROM bg_matches WHERE referee_user_id = ? AND status IN ('PENDING', 'READY')`,
        [userId],
      );
      return found.map((row) => Number(row.tournament_id));
    });
    for (const tournamentId of tournamentIds) invalidateCachedPrefix(`${REFEREE_NAMES_CACHE_PREFIX}${tournamentId}:`);
  } catch (error) {
    console.error("[referee-names] lecture des matchs arbitrés impossible", error);
    forgetRefereeNames();
    return;
  }
  if (tournamentIds.length === 0) return;
  // Import différé : `notifications` → `snapshot` → ce module.
  try {
    const { publishMatchUpdatedEvent } = await import("./notifications");
    for (const tournamentId of tournamentIds) publishMatchUpdatedEvent(tournamentId);
  } catch (error) {
    console.error("[referee-names] republication des tournois arbitrés impossible", error);
  }
}

type RefereeNameRow = RowDataPacket & { id: number; referee_user_id: number; pseudo: string };

/** Pseudo affichable d'une ligne lue (`visibleText`). */
function shownPseudo(raw: unknown): string {
  return visibleText(String(raw ?? "")).trim();
}

/**
 * Pseudos des arbitres que l'instantané montre (`showsRefereeName` : arbitre
 * désigné et encore éligible, **et** score pas encore déclaré — `PENDING`/`READY`,
 * textes RGPD « jusqu'à la déclaration de son score ou la fin du tournoi »). Jamais celui d'un compte supprimé ni d'un
 * arbitre dont l'opposition est retenue (`referee_objection_at`) : entre
 * l'écriture de l'opposition et le retrait de ses matchs — ou si ce balayage
 * échoue en partie —, le match reste « Arbitre désigné ». Une ligne relue après une nouvelle
 * désignation (ou un renommage) porte une autre empreinte que l'instantané :
 * elle est écartée, le client gardant « Arbitre désigné » jusqu'à l'instantané suivant.
 */
export async function loadRefereeNames(snapshot: TournamentSnapshot): Promise<RefereeNamesRead> {
  const shown = new Map<number, string>();
  for (const match of snapshot.matches) {
    if (showsRefereeName(match) && match.refereeKey !== null) shown.set(match.id, match.refereeKey);
  }
  if (shown.size === 0) return NO_REFEREE_NAMES;
  return cached(`${REFEREE_NAMES_CACHE_PREFIX}${snapshot.card.id}:${snapshot.version}`, REFEREE_NAMES_TTL_MS, async () => {
    // Les seuls matchs montrés : ni les joués ni les autres ne sont lus.
    const ids = [...shown.keys()];
    const rows = await withConnection(async (connection) => {
      const [result] = await connection.query<RefereeNameRow[]>(
        `SELECT m.id, m.referee_user_id, u.pseudo
           FROM bg_matches m
           JOIN bg_users u ON u.id = m.referee_user_id
          WHERE m.tournament_id = ? AND m.id IN (${ids.map(() => "?").join(", ")})
            AND m.referee_user_id IS NOT NULL
            AND u.is_deleted = 0 AND u.referee_objection_at IS NULL`,
        [snapshot.card.id, ...ids],
      );
      return result;
    });
    const designations: RefereeDesignation[] = [];
    for (const row of rows) {
      const matchId = Number(row.id);
      const refereeUserId = Number(row.referee_user_id);
      const key = refereeKey(matchId, refereeUserId, String(row.pseudo ?? ""));
      if (shown.get(matchId) !== key) continue;
      designations.push({ matchId, refereeKey: key, pseudo: shownPseudo(row.pseudo), refereeUserId });
    }
    return readOf(designations);
  });
}

type LiveRefereeRow = RowDataPacket & RefereeKeptRow & { id: number; referee_user_id: number; referee_pseudo: string };

/**
 * Les mêmes pseudos, lus **sans l'instantané** : la relecture légère
 * (`GET /api/tournaments/[id]/referee-names`) d'un tournoi dont la carte
 * visible est déjà lue. Une requête indexée sur les matchs à jouer arbitrés, la
 * règle de l'arbitre retenu (`refereeKept`) et l'empreinte de l'instantané
 * appliquées ligne à ligne — au lieu de reconstruire l'instantané entier une
 * fois son cache expiré. Un tournoi terminé ne nomme personne
 * (`withoutRefereeKeys`). Gardée jusqu'à la prochaine écriture du tournoi
 * (`forgetLiveRefereeNames`), une demi-minute au plus.
 */
export async function loadLiveRefereeNames(card: Pick<TournamentCard, "id" | "game" | "state">): Promise<RefereeNamesRead> {
  if (card.state === "FINISHED") return NO_REFEREE_NAMES;
  return cached(liveCacheKey(card.id), REFEREE_NAMES_TTL_MS, async () => {
    const rows = await withConnection(async (connection) => {
      const [result] = await connection.query<LiveRefereeRow[]>(
        `SELECT m.id, m.status, m.team1_id, m.team2_id, m.launch_pairing, m.launched_at, m.referee_user_id,
                ru.pseudo AS referee_pseudo,
                ru.discord_verified_at AS referee_discord_verified_at,
                ru.discord_pseudo AS referee_discord_pseudo,
                ru.blizzard_sub AS referee_blizzard_sub,
                ru.overwatch_battletag AS referee_overwatch_battletag,
                ru.overwatch_battletag_typed AS referee_overwatch_battletag_typed,
                ru.is_deleted AS referee_is_deleted,
                ru.is_admin AS referee_is_admin,
                ru.platform_roles_json AS referee_platform_roles_json,
                ru.referee_objection_at AS referee_objection_at,
                ${playsMatchSql("m.referee_user_id", "m.team1_id", "m.team2_id", "r")} AS referee_plays_match
           FROM bg_matches m
           JOIN bg_users ru ON ru.id = m.referee_user_id
          WHERE m.tournament_id = ? AND m.status IN ('PENDING', 'READY') AND m.referee_user_id IS NOT NULL
            AND ru.is_deleted = 0 AND ru.referee_objection_at IS NULL`,
        [card.id],
      );
      return result;
    });
    const designations: RefereeDesignation[] = [];
    for (const row of rows) {
      if (!refereeKept(row, card.game)) continue;
      const matchId = Number(row.id);
      const refereeUserId = Number(row.referee_user_id);
      const key = refereeKey(matchId, refereeUserId, String(row.referee_pseudo ?? ""));
      designations.push({ matchId, refereeKey: key, pseudo: shownPseudo(row.referee_pseudo), refereeUserId });
    }
    return readOf(designations);
  });
}
