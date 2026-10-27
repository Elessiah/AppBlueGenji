/**
 * Page d'un match (`/tournois/[id]/matchs/[matchId]`, sans compte
 * `/suivre/tournois/[id]/matchs/[matchId]`) — `docs/features/MATCH_PAGE.md`.
 *
 * Module pur : chemins, côtés (hôte à gauche), streams avec leurs casters et
 * aide-mémoire de l'autogestion se testent sans rendu. La page ne décide rien
 * d'autre : ce qu'un lecteur y lit de privé (BattleTags, arbitre nommé) vient
 * de la même lecture que la modale « Contacts » (`GET /api/matches/[id]/contacts`),
 * et ses gestes sont ceux de la carte du match.
 */
import { parseEntityPageId } from "./entity-page-titles";
import { refereeDecision, type RefereeDecision } from "./match-referee";
import type { MatchLiveState } from "./live-streams";
import type { BracketMatch, MatchCaster } from "./types";

/** Segment des pages de match sous la fiche d'un tournoi. */
const MATCHES_SEGMENT = "matchs";

/**
 * Chemin de la page d'un match, sans préfixe de langue : dans l'espace connecté,
 * ou sur la page sans compte (`spectator`).
 */
export function matchPagePath(tournamentId: number, matchId: number, spectator = false): string {
  const base = spectator ? "/suivre/tournois" : "/tournois";
  return `${base}/${tournamentId}/${MATCHES_SEGMENT}/${matchId}`;
}

export type MatchPageIds = { tournamentId: number; matchId: number };

/** Identifiants de `<préfixe><tournoi>/matchs/<match>` (barre finale tolérée), `null` ailleurs. */
function matchPageIdsUnder(prefix: string, path: string | null | undefined): MatchPageIds | null {
  if (!path?.startsWith(prefix)) return null;
  const parts = path.slice(prefix.length).replace(/\/$/, "").split("/");
  if (parts.length !== 3 || parts[1] !== MATCHES_SEGMENT) return null;
  // Chiffres seuls : « 1e2 » ou « 0x1 » ne désignent aucun match.
  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[2])) return null;
  const tournamentId = parseEntityPageId(parts[0]);
  const matchId = parseEntityPageId(parts[2]);
  return tournamentId === null || matchId === null ? null : { tournamentId, matchId };
}

/**
 * Le match désigné par un chemin de page de match de l'espace connecté
 * (`/tournois/12/matchs/345`), `null` pour toute autre page : un visiteur sans
 * session y est renvoyé vers la page sans compte, comme pour la fiche.
 */
export function matchPageIdsFromMemberPath(path: string | null | undefined): MatchPageIds | null {
  return matchPageIdsUnder("/tournois/", path);
}

/**
 * Le match désigné par un chemin de page de match **sans compte**
 * (`/suivre/tournois/12/matchs/345`), `null` ailleurs : un membre connecté y
 * est renvoyé vers la page du match de son espace.
 */
export function matchPageIdsFromSpectatorPath(path: string | null | undefined): MatchPageIds | null {
  return matchPageIdsUnder("/suivre/tournois/", path);
}

/** Le côté d'une partie : l'engagé (ou sa case vide) et son rôle à la création. */
export type MatchPageSide = {
  slot: 1 | 2;
  teamId: number | null;
  name: string | null;
  placeholder: string | null;
  /** Crée la partie (côté gauche). */
  host: boolean;
  /** Bannit la première (l'équipe qui n'héberge pas). */
  firstBan: boolean;
};

/**
 * Les deux côtés de la partie, **hôte à gauche** : l'équipe résolue par
 * `hostTeamId` (désignée par l'arbitrage, meilleure tête de série en phase
 * finale de BlueGenji Survie, sinon l'équipe 1), l'autre à droite. Sans hôte
 * connu (adversaire manquant), l'ordre du plateau.
 */
export function matchPageSides(
  match: Pick<
    BracketMatch,
    "team1Id" | "team2Id" | "team1Name" | "team2Name" | "team1Placeholder" | "team2Placeholder" | "hostTeamId" | "firstBanTeamId"
  >,
): [MatchPageSide, MatchPageSide] {
  const side = (slot: 1 | 2): MatchPageSide => {
    const teamId = slot === 1 ? match.team1Id : match.team2Id;
    return {
      slot,
      teamId,
      name: slot === 1 ? match.team1Name : match.team2Name,
      placeholder: slot === 1 ? match.team1Placeholder : match.team2Placeholder,
      host: teamId !== null && match.hostTeamId === teamId,
      firstBan: teamId !== null && match.firstBanTeamId === teamId,
    };
  };
  const one = side(1);
  const two = side(2);
  return two.host ? [two, one] : [one, two];
}

/** Un stream du match tel que la page le présente : son lien public et ses casters. */
export type MatchPageStream = {
  id: number;
  /** Lien affichable ; `null` = pas de lien public (absent, ou match pas encore annoncé casté). */
  url: string | null;
  casters: MatchCaster[];
};

/**
 * Tous les streams du match, chacun avec ses casters — le premier lien en tête
 * (celui des vues compactes, `BracketMatch.liveUrl`), puis l'ordre
 * d'ouverture. Un stream sans caster visible n'est montré que s'il porte un
 * lien affichable (celui de la configuration du direct). Les liens suivent la
 * règle de la carte : tus tant que le match n'est pas annoncé casté
 * (`liveState` `OFF`). Un premier lien qu'aucun stream ne porte vient en tête,
 * sous l'identifiant `0`.
 */
export function matchPageStreams(
  match: Pick<BracketMatch, "liveUrl" | "streams" | "casters">,
  liveState: MatchLiveState,
): MatchPageStream[] {
  const linksShown = liveState !== "OFF";
  const rows = match.streams
    .map((stream) => ({
      id: stream.id,
      url: linksShown ? stream.liveUrl : null,
      casters: match.casters.filter((caster) => caster.streamId === stream.id),
    }))
    .filter((row) => row.casters.length > 0 || row.url !== null);
  if (match.liveUrl === null || !linksShown) return rows;
  const firstIndex = rows.findIndex((row) => row.url === match.liveUrl);
  // Premier lien des vues compactes qu'aucun stream visible ne porte (stream
  // d'un caster retiré, lecture partielle) : montré quand même, comme sur le
  // bandeau de la carte (`matchStreamLinks`), sans caster.
  if (firstIndex === -1) return [{ id: 0, url: match.liveUrl, casters: [] }, ...rows];
  if (firstIndex === 0) return rows;
  return [rows[firstIndex], ...rows.slice(0, firstIndex), ...rows.slice(firstIndex + 1)];
}

/**
 * Ce que la page dit de l'arbitrage : l'arbitre, l'autogestion, ou — pour le
 * staff seul (permission `tournaments`) — l'absence de décision. `null` : rien
 * à dire (match terminé, exemption, ou lecteur hors staff sans décision).
 * Même règle que le bandeau de la carte (`refereeStripState`), sans sa phase
 * de lancement : la page le dit dès que le match existe.
 */
export function matchPageDecision(
  match: Pick<BracketMatch, "status" | "refereeAssigned" | "selfManaged" | "team1Id" | "team2Id">,
  staff: boolean,
): RefereeDecision | null {
  if (match.status === "COMPLETED") return null;
  const byeLike = (match.team1Id === null) !== (match.team2Id === null) && match.status !== "PENDING";
  if (byeLike) return null;
  const decision = refereeDecision(match);
  return decision === "UNDECIDED" && !staff ? null : decision;
}

/**
 * Le champ « Première map » de la page reprend-il la carte du plateau ? Oui
 * tant qu'il n'a pas été modifié ; après un enregistrement (`saved`, la valeur
 * envoyée), seulement quand le plateau relu la porte — sinon l'ancienne carte
 * revenait dans le champ jusqu'au prochain instantané.
 */
export function firstMapFieldFollows(current: string | null, edited: boolean, saved: string | null): boolean {
  if (saved !== null) return (current ?? "") === saved;
  return !edited;
}

/** Étapes de l'autogestion, dans l'ordre (spécification de l'utilisateur, 2026-10-26). */
export const SELF_MANAGEMENT_STEPS = ["hostCreates", "managersInvite", "settings", "inviteCasters"] as const;

export type SelfManagementStep = (typeof SELF_MANAGEMENT_STEPS)[number];

/**
 * Aide-mémoire d'un match en autogestion : l'hôte crée la partie, les managers
 * s'invitent, les paramètres sont réglés, les casters invités — cette
 * dernière étape seulement quand le match a un caster.
 */
export function selfManagementSteps(casterCount: number): SelfManagementStep[] {
  return SELF_MANAGEMENT_STEPS.filter((step) => step !== "inviteCasters" || casterCount > 0);
}
