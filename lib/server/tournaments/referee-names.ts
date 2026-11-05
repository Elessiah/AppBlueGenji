/**
 * Pseudo de l'arbitre désigné d'un match, **pour les membres connectés**
 * (décision 52, `docs/features/MATCH_REFEREE.md` § « Ce que chacun voit »).
 *
 * L'instantané partagé ne nomme personne : il porte, par match, une
 * **empreinte opaque** de la désignation (`refereeKey`) — qui change quand
 * l'arbitre change, sans désigner aucun compte — et le contexte du lecteur
 * (`TournamentViewerContext.refereeNames`, servi par le flux **et** par la
 * lecture REST de secours, toutes deux réservées aux comptes) porte les pseudos
 * avec la même empreinte. La page sans compte (`spectatorSnapshot`,
 * `SPECTATOR_VIEWER_CONTEXT`) n'a ni l'une ni l'autre : elle lit « Arbitre
 * désigné ».
 *
 * L'empreinte est un HMAC (secret tiré au démarrage du processus, jamais
 * stocké ni transmis) du match et du compte : elle n'est pas la même d'un match
 * à l'autre pour un même arbitre, et ne se remonte pas jusqu'au compte. Un
 * redémarrage la change : le client relit alors une fois les pseudos.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { cached } from "@/lib/server/cache";
import { withConnection } from "@/lib/server/database";
import { visibleText } from "@/lib/shared/visible-text";
import { showsRefereeName } from "@/lib/shared/match-referee";
import type { BracketMatch, MatchRefereeName, TournamentSnapshot } from "@/lib/shared/types";

/**
 * Secret tenu sur `globalThis` : une seconde évaluation du module (rechargement
 * à chaud, double bundle) garde celui des empreintes déjà mises en cache.
 */
const holder = globalThis as typeof globalThis & { __bgRefereeKeySecret?: Buffer };
holder.__bgRefereeKeySecret ??= randomBytes(32);
const KEY_SECRET = holder.__bgRefereeKeySecret;

/** Longueur de l'empreinte (base64url) : 96 bits, assez pour ne jamais se répéter sur un plateau. */
const REFEREE_KEY_LENGTH = 16;

/** Empreinte opaque de la désignation de `refereeUserId` sur `matchId`. */
export function refereeKey(matchId: number, refereeUserId: number): string {
  return createHmac("sha256", KEY_SECRET)
    .update(`${matchId}:${refereeUserId}`)
    .digest("base64url")
    .slice(0, REFEREE_KEY_LENGTH);
}

/**
 * Matchs d'un tournoi terminé, sans empreinte d'arbitre : un match resté non
 * joué (reset de grande finale inutile, fin forcée) ne nomme plus son arbitre
 * aux membres une fois le tournoi fini. Garde la même référence si rien ne change.
 */
export function withoutRefereeKeys<T extends { refereeKey: string | null }>(matches: T[]): T[] {
  if (!matches.some((match) => match.refereeKey !== null)) return matches;
  return matches.map((match) => (match.refereeKey === null ? match : { ...match, refereeKey: null }));
}

/**
 * Marque (`mine`) les désignations dont le lecteur est l'arbitre : la liste
 * lue est commune à tous les membres (mise en cache), la marque se pose après,
 * par lecteur — elle ne nomme personne de plus, seulement le lecteur à lui-même.
 *
 * La marque ne dépend pas du pseudo : un arbitre dont le pseudo ne s'affiche
 * pas (`visibleText` vide, absent de la liste commune) est reconnu sur
 * l'empreinte des matchs montrés (`matches`) et reçoit une entrée **sans
 * pseudo** (`""`, lue « Arbitre désigné » : `refereeNameOf`) — sans quoi la
 * médiation que le serveur lui accorde n'aurait aucun bouton.
 * Garde la même référence si rien n'est marqué.
 */
export function markViewerReferee(
  names: MatchRefereeName[],
  viewerUserId: number,
  matches: readonly Pick<BracketMatch, "id" | "refereeKey" | "status">[],
): MatchRefereeName[] {
  let marked = false;
  // Une empreinte par match, calculée une fois pour les deux boucles.
  const keys = new Map<number, string>();
  const keyOf = (matchId: number): string => {
    let key = keys.get(matchId);
    if (key === undefined) {
      key = refereeKey(matchId, viewerUserId);
      keys.set(matchId, key);
    }
    return key;
  };
  const out = names.map((name): MatchRefereeName => {
    if (keyOf(name.matchId) !== name.refereeKey) return name;
    marked = true;
    return { ...name, mine: true as const };
  });
  // Les entrées déjà là, par match et empreinte : une recherche, pas un parcours par match.
  const listed = new Set(out.map((name) => `${name.matchId}:${name.refereeKey}`));
  for (const match of matches) {
    if (!showsRefereeName(match) || match.refereeKey !== keyOf(match.id)) continue;
    if (listed.has(`${match.id}:${match.refereeKey}`)) continue;
    marked = true;
    out.push({ matchId: match.id, refereeKey: match.refereeKey, pseudo: "", mine: true });
  }
  return marked ? out : names;
}

/**
 * Durée de vie des pseudos lus pour une version d'instantané : la clé porte la
 * version, toute écriture en fait une autre ; la durée ne sert qu'à absorber
 * une vague d'ouvertures de flux (tous les membres lisent les mêmes pseudos).
 */
const REFEREE_NAMES_TTL_MS = 5_000;

type RefereeNameRow = RowDataPacket & { id: number; referee_user_id: number; pseudo: string };

/**
 * Pseudos des arbitres que l'instantané montre (`showsRefereeName` : arbitre
 * désigné et encore éligible, **et** score pas encore déclaré — `PENDING`/`READY`,
 * textes RGPD « jusqu'à la déclaration de son score ou la fin du tournoi »). Jamais celui d'un compte supprimé ni d'un
 * arbitre dont l'opposition est retenue (`referee_objection_at`) : entre
 * l'écriture de l'opposition et le retrait de ses matchs — ou si ce balayage
 * échoue en partie —, le match reste « Arbitre désigné ». Une ligne relue après une nouvelle
 * désignation porte une autre empreinte que l'instantané : elle est écartée,
 * le client gardant « Arbitre désigné » jusqu'à l'instantané suivant.
 */
export async function loadRefereeNames(snapshot: TournamentSnapshot): Promise<MatchRefereeName[]> {
  const shown = new Map<number, string>();
  for (const match of snapshot.matches) {
    if (showsRefereeName(match) && match.refereeKey !== null) shown.set(match.id, match.refereeKey);
  }
  if (shown.size === 0) return [];
  return cached(`referee-names:${snapshot.card.id}:${snapshot.version}`, REFEREE_NAMES_TTL_MS, async () => {
    const rows = await withConnection(async (connection) => {
      const [result] = await connection.query<RefereeNameRow[]>(
        `SELECT m.id, m.referee_user_id, u.pseudo
           FROM bg_matches m
           JOIN bg_users u ON u.id = m.referee_user_id
          WHERE m.tournament_id = ? AND m.referee_user_id IS NOT NULL
            AND u.is_deleted = 0 AND u.referee_objection_at IS NULL`,
        [snapshot.card.id],
      );
      return result;
    });
    const names: MatchRefereeName[] = [];
    for (const row of rows) {
      const matchId = Number(row.id);
      const key = refereeKey(matchId, Number(row.referee_user_id));
      if (shown.get(matchId) !== key) continue;
      const pseudo = visibleText(String(row.pseudo ?? "")).trim();
      if (pseudo !== "") names.push({ matchId, refereeKey: key, pseudo });
    }
    return names;
  });
}
