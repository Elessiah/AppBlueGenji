/**
 * Avis au caster dont l'inscription sur un match est retirée par un autre que
 * lui — le sujet de l'avis et son motif, sans réseau ni base
 * (`docs/features/CAST_NOTICES.md`). Le message privé s'écrit côté serveur
 * (`lib/server/tournaments/cast-release-message.ts`), la notification push dans
 * `push-messages.ts`.
 *
 * Le caster qui se retire lui-même ne reçoit rien : il sait. Les autres cas
 * reçoivent un message privé Discord et une notification push (`CAST_RELEASED`),
 * **avec le motif** :
 *
 * - `STAFF` — le staff a retiré l'inscription (jamais nommé) ;
 * - `REPLACED` — le caster ne remplissait plus les conditions du cast, et un
 *   autre caster a pris le match ;
 * - `INELIGIBLE` — retirée d'office : les conditions du cast ne sont plus
 *   remplies ; la condition qui manque (`block`) précise le motif — permission
 *   de diffusion perdue, ou identité de caster incomplète (tag Discord
 *   certifié, compte Battle.net) ;
 * - `JOINED_TEAM` — retirée d'office : il joue désormais le match (avec son
 *   équipe, ou seul en tournoi individuel).
 *
 * Aucun pseudo de joueur : en tournoi individuel, les engagés sont des
 * personnes, et le message dit « un match » (`RGPD_LOGS_AND_VISITS.md`).
 */
import type { CastBlock } from "./match-launch";
import { tournamentMatchHref } from "./match-anchor";

/** Motif donné au caster. L'énumération reste ouverte : l'arbitrage des matchs en ajoutera. */
/**
 * `MATCH_DELETED` — le match n'existe plus (retour arrière, manche régénérée,
 * plateau reconstruit) : l'inscription part avec lui.
 */
export type CastReleaseReason = "STAFF" | "REPLACED" | "INELIGIBLE" | "JOINED_TEAM" | "MATCH_DELETED";

/** Le match d'un avis de retrait, tel que la notification et le message le nomment. */
export type CastReleasedMatch = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  team1Name: string | null;
  team2Name: string | null;
  /** Tournoi individuel : les noms des engagés sont des pseudos, jamais écrits. */
  solo: boolean;
  reason: CastReleaseReason;
  /** `INELIGIBLE` : la condition qui manque ; absente, le motif cite toutes les conditions. */
  block?: CastBlock | null;
};

/** Clé du motif, déclinée selon la condition qui manque (`castReleased.reason.*`, message privé). */
export type CastReleaseReasonKey =
  | CastReleaseReason
  | "INELIGIBLE_PERMISSION"
  | "INELIGIBLE_IDENTITY"
  | "INELIGIBLE_DISCORD";

/**
 * Le motif tel que le caster le lit : un retrait d'office dit **la** condition
 * qui manque quand elle est connue — la permission de diffusion perdue ne se
 * corrige pas comme un compte Battle.net délié.
 */
export function castReleaseReasonKey(match: Pick<CastReleasedMatch, "reason" | "block">): CastReleaseReasonKey {
  if (match.reason !== "INELIGIBLE") return match.reason;
  if (match.block === "NOT_CASTER") return "INELIGIBLE_PERMISSION";
  if (match.block === "CASTER_IDENTITY_REQUIRED") return "INELIGIBLE_IDENTITY";
  if (match.block === "CASTER_DISCORD_REQUIRED") return "INELIGIBLE_DISCORD";
  return "INELIGIBLE";
}

/**
 * Chemin du lien d'un avis de retrait : le match sur la fiche du tournoi, ou
 * le tournoi seul quand le match n'existe plus (`MATCH_DELETED`) — une ancre
 * vers un match effacé ne mènerait nulle part.
 */
export function castReleasedHref(match: Pick<CastReleasedMatch, "tournamentId" | "matchId" | "reason">): string {
  return tournamentMatchHref(match.tournamentId, match.reason === "MATCH_DELETED" ? null : match.matchId);
}
