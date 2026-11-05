/**
 * Porte des routes de diffusion d'un match (`/api/admin/matches/[id]/live`
 * et sa rediff) : qui y entre, et la lecture des liens que l'arbitre règle.
 */
import type { AuthUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { isDesignatedMatchReferee, type MatchStreamLinkEdit } from "./live-streams";

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
 * Qui règle la diffusion d'un match : la permission `live`, ou l'arbitre
 * désigné **de ce match** (médiateur, `docs/features/CAST_SETTINGS.md`) — la
 * permission `tournaments` est la condition de son arbitrage.
 */
export async function mayConfigureMatchLive(user: AuthUser, matchId: number): Promise<boolean> {
  if (can(user, "live")) return true;
  return isDesignatedMatchReferee(matchId, user.id, can(user, "tournaments"));
}
