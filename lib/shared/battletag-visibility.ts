/**
 * Le BattleTag d'un joueur : qui le lit quand son titulaire l'a **masqué**.
 *
 * Décocher « BattleTag OW » sur `/profil` le retire de **partout** — fiche,
 * annuaire, rosters —, pour tout le monde, arbitres et administrateurs compris,
 * **sauf** dans la fenêtre « Contacts » d'un match, quand elle est ouverte au
 * lecteur (décision de l'utilisateur, 2026-10-19) : membres des deux équipes et
 * arbitres (permission `tournaments`) dès que les deux adversaires sont connus,
 * caster inscrit le temps du match seulement ; ceux du caster, aux équipes le
 * temps du match, aux arbitres dès que les adversaires sont connus (décision
 * du 2026-10-21). C'est la clause `sharesLiveMatch`, que seul
 * `lib/server/tournaments/match-launch-info.ts` pose, au moment de présenter ces
 * contacts. La modale ouverte à la bascule (`BattletagVisibilityNotice.tsx`) le
 * dit au joueur. Base : l'exécution du service (registre T04, conditions
 * d'utilisation « Contacts de match »).
 *
 * Module **pur** : le fait de match est établi par l'appelant.
 */
import type { PlatformRole } from "./permissions";

/** Ce que le module a besoin de savoir du **lecteur**. */
export type BattletagViewer = {
  id: number;
  isAdmin?: boolean;
  roles?: readonly PlatformRole[];
};

/** Ce que le module a besoin de savoir du **titulaire** et de son lien au lecteur. */
export type BattletagSubject = {
  /** Compte dont on veut lire le BattleTag. */
  userId: number;
  /** Réglage `visible_overwatch` du titulaire. */
  visible: boolean;
  /**
   * Le tag est-il lu dans la fenêtre « Contacts » d'un match ouverte au lecteur ?
   * Posé par `match-launch-info.ts` seulement.
   */
  sharesLiveMatch?: boolean;
};

/**
 * Le lecteur peut-il voir le BattleTag du titulaire ?
 *
 * 1. **soi-même** — toujours ;
 * 2. **visible** — tout le monde, visiteur sans compte compris ;
 * 3. **masqué** — seulement dans la fenêtre « Contacts » d'un match ouverte au
 *    lecteur (`sharesLiveMatch`) ; aucun passe-droit de rôle.
 */
export function canViewBattletag(
  viewer: BattletagViewer | null | undefined,
  subject: BattletagSubject,
): boolean {
  if (viewer?.id === subject.userId) return true;
  if (subject.visible) return true;
  if (!viewer) return false;
  return Boolean(subject.sharesLiveMatch);
}

/**
 * Le BattleTag tel qu'il doit sortir, ou `null`.
 *
 * Posé **à la sortie**, comme `visibleDiscordTag` et `visibleAvatarUrl` : un
 * écran ajouté demain n'a rien à afficher plutôt qu'une règle à se rappeler.
 */
export function visibleBattletag(
  tag: string | null | undefined,
  viewer: BattletagViewer | null | undefined,
  subject: BattletagSubject,
): string | null {
  if (!tag) return null;
  return canViewBattletag(viewer, subject) ? tag : null;
}

/**
 * La **pastille** du BattleTag — prouvé par un compte Battle.net rattaché — se
 * lit-elle sur la fiche ?
 *
 * Toujours, BattleTag masqué compris, comme la certification Discord
 * (`canSeeDiscordVerification`) : le tag dit *comment* ajouter le joueur en jeu
 * et se filtre ; la pastille dit seulement *que* son BattleTag a été prouvé, ne
 * nomme personne et ne mène à personne. D'où « Masqué ✅ ». Une fonction plutôt
 * qu'une constante : c'est le seul endroit où la restreindre un jour.
 */
export function canSeeBattletagVerification(): boolean {
  return true;
}
