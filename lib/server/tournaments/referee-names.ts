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
import type { MatchRefereeName, TournamentSnapshot } from "@/lib/shared/types";

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
 * Durée de vie des pseudos lus pour une version d'instantané : la clé porte la
 * version, toute écriture en fait une autre ; la durée ne sert qu'à absorber
 * une vague d'ouvertures de flux (tous les membres lisent les mêmes pseudos).
 */
const REFEREE_NAMES_TTL_MS = 5_000;

type RefereeNameRow = RowDataPacket & { id: number; referee_user_id: number; pseudo: string };

/**
 * Pseudos des arbitres que l'instantané montre (`refereeKey` non nul : arbitre
 * désigné **et** encore éligible). Jamais celui d'un compte supprimé ni d'un
 * arbitre dont l'opposition est retenue (`referee_objection_at`) : entre
 * l'écriture de l'opposition et le retrait de ses matchs — ou si ce balayage
 * échoue en partie —, le match reste « Arbitre désigné ». Une ligne relue après une nouvelle
 * désignation porte une autre empreinte que l'instantané : elle est écartée,
 * le client gardant « Arbitre désigné » jusqu'à l'instantané suivant.
 */
export async function loadRefereeNames(snapshot: TournamentSnapshot): Promise<MatchRefereeName[]> {
  const shown = new Map<number, string>();
  for (const match of snapshot.matches) {
    if (match.refereeKey !== null) shown.set(match.id, match.refereeKey);
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
