/**
 * La prod d'un match (`docs/features/MATCH_PROD.md`) — module pur, partagé.
 *
 * Un match a ses casters (`bg_match_casters`, sans plafond) et **une** prod
 * (`bg_matches.prod_user_id`) : la production du direct (régie, scènes, son),
 * qui n'est pas un caster et ne compte pas parmi eux. Une prod se place
 * elle-même (permission `prod`) ou est placée par le staff (`tournaments`) ;
 * elle ne joue pas le match et n'en est pas caster (jamais caster et prod du
 * même match, comme au planning).
 *
 * Ce module décide ce que la carte offre et décrit l'avis au compte visé (le
 * message privé s'écrit côté serveur, la notification push dans
 * `push-messages.ts`). Aucun pseudo de joueur : en tournoi individuel, le match
 * se dit « un match » (`RGPD_LOGS_AND_VISITS.md`).
 */
import { isByeMatch } from "./match-page";
import { tournamentMatchHref } from "./match-anchor";
import type { BracketMatch, TournamentState } from "./types";

/** La prod d'un match telle que l'instantané la porte : son compte et son pseudo public. */
export type MatchProd = { userId: number; pseudo: string };

type ProdMatch = Pick<BracketMatch, "status" | "team1Id" | "team2Id" | "casters" | "prod">;

export type ProdViewer = {
  /** Permission `prod` tenue par la session : se placer soi-même. */
  canProd: boolean;
  /**
   * Quitter sa propre place : session hors incarnation sans `prod`, comme la
   * route — un compte qui a perdu le rôle rend encore la place qu'un match lancé lui a gardée.
   */
  canLeaveProd: boolean;
  /** Permission `tournaments` : placer ou retirer la prod d'un autre. */
  canSchedule: boolean;
  viewerUserId: number | null;
  /** Les engagées du lecteur : un joueur du match n'en est pas la prod. */
  myTeamIds: readonly number[];
};

export type ProdControls = {
  /** Le lecteur est la prod du match. */
  isProd: boolean;
  /** « Faire la prod » : place libre, match à jouer, ni joueur ni caster du match. */
  showClaim: boolean;
  /** « Ne plus faire la prod » : sa propre place, match à jouer, session qui peut la quitter (`canLeaveProd`). */
  showRelease: boolean;
  /** « Prod du match » (fenêtre du staff) : placer, changer ou retirer la prod. */
  showAssign: boolean;
};

/**
 * « Faire la prod » ne s'offre que dans un tournoi en cours : le serveur le
 * refuse ailleurs (`MATCH_NOT_LAUNCHABLE`), staff compris — le staff place une
 * prod d'avance par sa fenêtre « Prod du match ».
 */
export function prodClaimOpen(state: TournamentState): boolean {
  return state === "RUNNING";
}

/**
 * Ce que la carte offre de la prod. Même ouverture que le cast : un match à
 * jouer, jamais une exemption ; le serveur rejoue chaque règle sous verrou.
 */
export function prodControls(match: ProdMatch, viewer: ProdViewer): ProdControls {
  const prod = match.prod ?? null;
  const isProd = prod !== null && viewer.viewerUserId !== null && prod.userId === viewer.viewerUserId;
  const open = match.status !== "COMPLETED" && !isByeMatch(match);
  const isPlayer = [match.team1Id, match.team2Id].some((id) => id !== null && viewer.myTeamIds.includes(id));
  const isCaster =
    viewer.viewerUserId !== null && match.casters.some((caster) => caster.userId === viewer.viewerUserId);
  return {
    isProd,
    showClaim: viewer.canProd && open && prod === null && !isPlayer && !isCaster,
    showRelease: viewer.canLeaveProd && open && isProd,
    showAssign: viewer.canSchedule && open,
  };
}

/**
 * Ce qu'un avis dit au compte visé : placé par le staff (`ASSIGNED`), retiré
 * par lui (`RELEASED`, place rendue libre ou donnée à un autre), ou place
 * rendue d'office — rôle prod perdu (`INELIGIBLE`), compte qui ne peut plus la
 * tenir, sans dire pourquoi (`UNAVAILABLE` : suspendu), ou devenu joueur du
 * match (`JOINED_TEAM`). Un geste sur sa propre place ne lui envoie rien : il sait.
 */
export type ProdNoticeKind = "ASSIGNED" | "PLANNED" | "RELEASED" | "INELIGIBLE" | "UNAVAILABLE" | "JOINED_TEAM";

/** Le match d'un avis de prod, tel que la notification et le message le nomment. */
export type ProdNoticeMatch = {
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
  kind: ProdNoticeKind;
};

/** Chemin du lien d'un avis : le match sur la fiche du tournoi. */
export function prodNoticeHref(match: Pick<ProdNoticeMatch, "tournamentId" | "matchId">): string {
  return tournamentMatchHref(match.tournamentId, match.matchId);
}
