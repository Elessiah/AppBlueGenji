/**
 * Ce que le bandeau de lancement d'une carte de match (`MatchLaunchStrip`)
 * montre et offre, décidé hors du composant : une règle pure se teste sans
 * rendu, et le composant ne garde que la mise en page.
 */
import { matchUnderway, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";

type StripMatch = Pick<
  BracketMatch,
  "status" | "team1Id" | "team2Id" | "team1Name" | "team2Name" | "hostTeamId" | "casterUserId"
>;

export type LaunchStripViewer = {
  /** Permission `live` : s'inscrire comme caster. */
  canManage: boolean;
  /** Permission `tournaments` : planifier, forcer, changer d'hôte. */
  canSchedule: boolean;
  viewerUserId: number | null;
  myTeamId: number | null;
  /**
   * Option du tournoi « phase de lancement » : éteinte, la modale de lancement
   * ne présente pas ses matchs, et « Infos du match » n'ouvrirait rien.
   * Absente = allumée.
   */
  launchPhase?: boolean;
};

export type LaunchStripControls = {
  isCaster: boolean;
  /** Ouvrir la modale de lancement (parties du match seulement). */
  showOpen: boolean;
  /**
   * Ouvrir les contacts du match, pas terminé : joueurs et arbitres dès que
   * les deux adversaires sont connus, caster le temps du match seulement.
   */
  showContacts: boolean;
  /** S'inscrire comme caster. */
  showClaim: boolean;
  /** Se retirer du cast, ou retirer le caster (arbitrage). */
  showRelease: boolean;
  /** Ouvrir la date d'un match à planifier. */
  showPlan: boolean;
  /** Lancer sans attendre les « Prêt » — et, à planifier, sans date. */
  showForce: boolean;
  /** Annoncer l'équipe hôte. */
  showHost: boolean;
  /** Changer d'équipe hôte. */
  showHostSwap: boolean;
};

/** Phases où l'arbitrage peut forcer le départ : tout ce qui précède le lancement effectif. */
const FORCEABLE_PHASES: ReadonlySet<MatchLaunchPhase> = new Set(["TO_PLAN", "SCHEDULED", "LOBBY"]);

/**
 * Phases où le bouton « Contacts » est offert à un joueur du match (et à un
 * arbitre) : dès que
 * les deux adversaires sont connus — à planifier, programmé, en lancement ou
 * lancé —, celles où la lecture serveur les expose (`match-launch-info.ts`).
 */
const CONTACT_PHASES: ReadonlySet<MatchLaunchPhase> = new Set(["TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"]);


export function launchStripControls(
  match: StripMatch,
  phase: MatchLaunchPhase,
  viewer: LaunchStripViewer,
): LaunchStripControls {
  const isCaster = viewer.viewerUserId !== null && match.casterUserId === viewer.viewerUserId;
  const isPlayer =
    viewer.myTeamId !== null && (match.team1Id === viewer.myTeamId || match.team2Id === viewer.myTeamId);
  const open = match.status !== "COMPLETED";
  // Inscription comme caster : sur un match à jouer, jamais sur un bye (un
  // engagé connu en face d'une case vide), et jamais par un joueur du match.
  const isByeLike = (match.team1Id === null) !== (match.team2Id === null) && match.status !== "PENDING";
  const castable = open && !isByeLike && !isPlayer;
  const showHost = phase !== "NONE";
  return {
    isCaster,
    showOpen: (isCaster || isPlayer) && viewer.launchPhase !== false && matchUnderway(phase),
    // Un arbitre (permission `tournaments`) les lit comme un joueur du match.
    showContacts:
      (isPlayer || viewer.canSchedule) ? CONTACT_PHASES.has(phase) : // Au caster inscrit, le temps du match seulement — la borne du serveur.
        isCaster && matchUnderway(phase),
    showClaim: viewer.canManage && castable && match.casterUserId === null,
    showRelease: open && match.casterUserId !== null && (isCaster || viewer.canSchedule),
    showPlan: viewer.canSchedule && phase === "TO_PLAN",
    showForce: viewer.canSchedule && FORCEABLE_PHASES.has(phase),
    showHost,
    showHostSwap: viewer.canSchedule && showHost,
  };
}

/** Nom de l'équipe hôte, `null` sans hôte connu. */
export function hostTeamName(match: StripMatch): string | null {
  if (match.hostTeamId === null) return null;
  return match.hostTeamId === match.team1Id ? match.team1Name : match.team2Name;
}
