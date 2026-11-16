/**
 * Porte de la route de diffusion d'un match (`/api/admin/matches/[id]/live`) :
 * qui y entre, et la lecture des liens que l'arbitre règle. La rediff
 * (`…/replay`) n'y passe pas : elle reste à la seule permission `live`.
 */
import type { AuthUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import type { MatchStreamLinkEdit } from "./live-streams";

/** Au plus autant de liens de streams par envoi (un match n'en porte jamais tant). */
const MAX_STREAM_LINK_EDITS = 20;

/**
 * Lit `streamLinks` (médiation de l'arbitre) : absent → `undefined` ; sinon un
 * tableau de `{ streamId, liveUrl }` (identifiant entier positif, lien texte ou
 * `null`), sans doublon. `null` : corps illisible.
 */
export function parseStreamLinks(raw: unknown): MatchStreamLinkEdit[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_STREAM_LINK_EDITS) return null;
  const edits: MatchStreamLinkEdit[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const { streamId, liveUrl } = entry as { streamId?: unknown; liveUrl?: unknown };
    if (typeof streamId !== "number" || !Number.isInteger(streamId) || streamId <= 0) return null;
    if (liveUrl !== null && typeof liveUrl !== "string") return null;
    if (edits.some((edit) => edit.streamId === streamId)) return null;
    edits.push({ streamId, liveUrl });
  }
  return edits;
}

/**
 * Qui passe la porte de la route de diffusion d'un match : la permission
 * `live`, ou la permission `tournaments` — condition de l'arbitrage, pour
 * l'arbitre désigné **de ce match** (médiateur, `docs/features/CAST_SETTINGS.md`).
 *
 * Sans lecture de la base : que l'appelant soit bien l'arbitre retenu de ce
 * match se juge par le service — d'abord sans verrou pour qui n'a pas `live`
 * (`assertMayReachMatchLive`, `NOT_MATCH_REFEREE`, 403, même refus pour un
 * match absent), puis sous le verrou du match (`assertLiveActor`), avant tout
 * autre refus qui dirait l'état du match (mode, date, statut). Seul un porteur
 * de `live` apprend qu'un match n'existe pas (`MATCH_NOT_FOUND`, 404).
 */
export function mayConfigureMatchLive(user: AuthUser): boolean {
  return can(user, "live") || can(user, "tournaments");
}
