/**
 * Ce qu'une carte de match offre de son lancement et de son cast, décidé hors
 * des composants : une règle pure se teste sans rendu, et le pied d'action
 * (`MatchCardActions`) comme le bandeau (`MatchLaunchStrip`) ne gardent que la
 * mise en page.
 */
import { exposesMatchContacts, matchUnderway, readsContactsEarly, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { isByeMatch } from "@/lib/shared/match-page";
import type { BracketMatch } from "@/lib/shared/types";

type StripMatch = Pick<BracketMatch, "status" | "team1Id" | "team2Id" | "casters">;

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
  /**
   * Retirer **un autre** caster que le lecteur : l'arbitrage seul
   * (`canSchedule`, permission `tournaments`). Le caster qui se retire lui-même
   * ne passe plus par la carte : « Ne plus caster » vit dans sa fenêtre
   * « Configurer ma diffusion » (`docs/features/CAST_SETTINGS.md`), pour que la
   * carte n'ait qu'**un** bouton de cast.
   */
  showRelease: boolean;
  /** Ouvrir la date d'un match à planifier. */
  showPlan: boolean;
  /** Lancer sans attendre les « Prêt » — et, à planifier, sans date. */
  showForce: boolean;
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
  // Exemption : la règle partagée de la page du match (`isByeMatch`).
  const isByeLike = isByeMatch(match);
  const castable = open && !isByeLike && !isPlayer;
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
    showRelease:
      open && viewer.canSchedule && match.casters.some((caster) => caster.userId !== viewer.viewerUserId),
    showPlan: viewer.canSchedule && phase === "TO_PLAN",
    showForce: viewer.canSchedule && FORCEABLE_PHASES.has(phase),
    // L'hôte ne se change que là où il existe (phase de lancement ouverte).
    showHostSwap: viewer.canSchedule && phase !== "NONE",
    showReferee: viewer.canSchedule && open && !isByeLike,
  };
}

/** Pastille de la phase de lancement (`LaunchPhaseBadge`) ; `null` : aucune. */
export type LaunchPhaseBadgeKind = "TO_PLAN" | "SCHEDULED" | "LOBBY" | "LAUNCHED";

/**
 * Pastille à montrer pour une phase — seule règle de `LaunchPhaseBadge` et de
 * `hasLaunchPhaseBadge` (fait « Lancement » de la page du match) : une phase
 * ajoutée ici paraît aux deux, jamais un fait vide. « Lancé » ne se dit que
 * tant que le match se joue (`READY`).
 */
export function launchPhaseBadgeKind(
  match: Pick<BracketMatch, "status">,
  phase: MatchLaunchPhase,
): LaunchPhaseBadgeKind | null {
  if (phase === "TO_PLAN" || phase === "SCHEDULED" || phase === "LOBBY") return phase;
  if (phase === "LAUNCHED" && match.status === "READY") return "LAUNCHED";
  return null;
}
