/**
 * Ce que le bandeau de lancement d'une carte de match (`MatchLaunchStrip`)
 * montre et offre, décidé hors du composant : une règle pure se teste sans
 * rendu, et le composant ne garde que la mise en page.
 */
import { exposesMatchContacts, matchUnderway, readsContactsEarly, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { refereeDecision, type RefereeDecision } from "@/lib/shared/match-referee";
import type { BracketMatch } from "@/lib/shared/types";

type StripMatch = Pick<
  BracketMatch,
  | "status"
  | "team1Id"
  | "team2Id"
  | "team1Name"
  | "team2Name"
  | "hostTeamId"
  | "casters"
  | "firstBanTeamId"
  | "refereeAssigned"
  | "selfManaged"
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
  /** S'inscrire comme caster — sans plafond : co-caster ou ouvrir son stream. */
  showClaim: boolean;
  /** Se retirer du cast, ou retirer un des casters (arbitrage). */
  showRelease: boolean;
  /**
   * L'arbitrage peut retirer un **autre** caster que le lecteur : le retrait
   * passe par le choix du caster, même quand le lecteur caste aussi le match.
   */
  releasesOthers: boolean;
  /** Ouvrir la date d'un match à planifier. */
  showPlan: boolean;
  /** Lancer sans attendre les « Prêt » — et, à planifier, sans date. */
  showForce: boolean;
  /** Annoncer l'équipe hôte. */
  showHost: boolean;
  /** Changer d'équipe hôte. */
  showHostSwap: boolean;
  /**
   * Ouvrir la fenêtre « Arbitrage » (arbitre désigné, autogestion, première
   * carte) : permission `tournaments`, match à jouer, jamais sur un bye.
   */
  showReferee: boolean;
};

/** Phases où l'arbitrage peut forcer le départ : tout ce qui précède le lancement effectif. */
const FORCEABLE_PHASES: ReadonlySet<MatchLaunchPhase> = new Set(["TO_PLAN", "SCHEDULED", "LOBBY"]);

export function launchStripControls(
  match: StripMatch,
  phase: MatchLaunchPhase,
  viewer: LaunchStripViewer,
): LaunchStripControls {
  const isCaster =
    viewer.viewerUserId !== null && match.casters.some((caster) => caster.userId === viewer.viewerUserId);
  const isPlayer =
    viewer.myTeamId !== null && (match.team1Id === viewer.myTeamId || match.team2Id === viewer.myTeamId);
  const open = match.status !== "COMPLETED";
  // Inscription comme caster : sur un match à jouer, jamais sur un bye (un
  // engagé connu en face d'une case vide), et jamais par un joueur du match.
  const isByeLike = (match.team1Id === null) !== (match.team2Id === null) && match.status !== "PENDING";
  const castable = open && !isByeLike && !isPlayer;
  const showHost = phase !== "NONE";
  // `canSchedule` : la permission `tournaments`, celle de l'arbitre au serveur.
  const early = readsContactsEarly({ playsMatch: isPlayer, referee: viewer.canSchedule });
  return {
    isCaster,
    showOpen: (isCaster || isPlayer) && viewer.launchPhase !== false && matchUnderway(phase),
    // La règle du serveur (`exposesMatchContacts`) : un arbitre (permission
    // `tournaments`) les lit comme un joueur du match, dès que les deux
    // adversaires sont connus ; le caster inscrit, le temps du match seulement.
    showContacts: (early || isCaster) && exposesMatchContacts(phase, early),
    showClaim: viewer.canManage && castable && !isCaster,
    showRelease: open && match.casters.length > 0 && (isCaster || viewer.canSchedule),
    releasesOthers:
      open && viewer.canSchedule && match.casters.some((caster) => caster.userId !== viewer.viewerUserId),
    showPlan: viewer.canSchedule && phase === "TO_PLAN",
    showForce: viewer.canSchedule && FORCEABLE_PHASES.has(phase),
    showHost,
    showHostSwap: viewer.canSchedule && showHost,
    showReferee: viewer.canSchedule && open && !isByeLike,
  };
}

/** Nom de l'équipe hôte, `null` sans hôte connu. */
export function hostTeamName(match: StripMatch): string | null {
  if (match.hostTeamId === null) return null;
  return match.hostTeamId === match.team1Id ? match.team1Name : match.team2Name;
}

/** Nom de l'équipe qui bannit la première (celle qui n'héberge pas), `null` sans adversaires connus. */
export function firstBanTeamName(match: StripMatch): string | null {
  if (match.firstBanTeamId === null) return null;
  return match.firstBanTeamId === match.team1Id ? match.team1Name : match.team2Name;
}

/**
 * Ce que le bandeau dit de l'arbitrage (`docs/features/MATCH_REFEREE.md`) :
 * « Arbitre désigné » ou « Autogestion » pour tous — jamais un nom —, et
 * « Sans arbitre » pour le **staff** seul (`staff`, permission `tournaments`),
 * là où une décision est attendue. Rien sur un match terminé ou sans phase.
 */
export function refereeStripState(
  match: Pick<StripMatch, "status" | "refereeAssigned" | "selfManaged">,
  phase: MatchLaunchPhase,
  staff: boolean,
): RefereeDecision | null {
  if (phase === "NONE" || match.status === "COMPLETED") return null;
  const decision = refereeDecision({ refereeAssigned: match.refereeAssigned, selfManaged: match.selfManaged });
  if (decision === "UNDECIDED" && !staff) return null;
  return decision;
}
