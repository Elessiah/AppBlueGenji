/**
 * Le BattleTag d'un joueur : qui le lit quand son titulaire l'a **masqué**.
 *
 * Décocher « BattleTag OW » sur `/profil` le retire de la fiche publique et de
 * l'annuaire — et **pas** de là où il sert à jouer. La modale ouverte à la
 * bascule (`BattletagVisibilityNotice.tsx`) le dit au joueur ; ce module est ce
 * qui le tient. Avant lui, `applyVisibility` effaçait le tag pour tout lecteur
 * dès que `visible_overwatch` était faux : la modale décrivait une exception
 * que le code n'appliquait pas, et un adversaire ne pouvait plus ajouter en jeu
 * le joueur qu'il devait affronter.
 *
 * **Deux publics, une même borne : le tournoi vivant** (tout état sauf
 * `FINISHED`, la phrase de `tournamentGrantsContactAccess`). Le besoin naît du
 * tournoi et s'éteint avec lui — une fois le palmarès écrit, il n'y a plus de
 * partie à lancer ni de manche à arbitrer :
 * - les **autres joueurs d'un match** que le titulaire dispute (adversaires et
 *   coéquipiers) : c'est par le BattleTag qu'on s'ajoute en jeu ;
 * - la **permission `tournaments`** (arbitres, administrateurs), quand le
 *   titulaire est engagé dans un tournoi vivant.
 *
 * **Ce n'est pas la règle du tag Discord**, et l'écart est voulu. Le tag Discord
 * n'a pas de réglage : il n'est jamais public, et l'administrateur le lit en
 * tout temps. Le BattleTag en a un, que le joueur garde en main — l'exception ne
 * doit pas le vider de son sens, d'où aucun passe-droit hors tournoi, pas même
 * pour un administrateur. Le cast (`casting`) n'y a aucun droit : diffuser n'est
 * pas jouer.
 *
 * Module **pur** : les deux faits de tournoi sont établis par l'appelant, qui
 * seul a la base sous la main.
 */
import { can, type PlatformRole } from "./permissions";

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
   * Lecteur et titulaire sont-ils engagés dans un **même match** d'un tournoi
   * vivant ? Relatif au lecteur, établi par l'appelant.
   */
  sharesLiveMatch?: boolean;
  /** Le titulaire est-il engagé dans un tournoi vivant ? Fait global. */
  inActiveTournament?: boolean;
};

/**
 * Le lecteur peut-il voir le BattleTag du titulaire ?
 *
 * L'ordre des cas est la règle :
 * 1. **soi-même** — toujours ;
 * 2. **visible** — tout le monde, visiteur sans compte compris : c'est le choix
 *    du titulaire ;
 * 3. **masqué**, lecteur anonyme — personne ;
 * 4. **même match** d'un tournoi vivant — oui ;
 * 5. **permission `tournaments`** — seulement si le titulaire est engagé dans un
 *    tournoi vivant ;
 * 6. tout le reste — non.
 */
export function canViewBattletag(
  viewer: BattletagViewer | null | undefined,
  subject: BattletagSubject,
): boolean {
  if (viewer && viewer.id === subject.userId) return true;
  if (subject.visible) return true;
  if (!viewer) return false;
  if (subject.sharesLiveMatch) return true;
  if (can(viewer, "tournaments")) return Boolean(subject.inActiveTournament);
  return false;
}

/**
 * Faut-il poser les questions de tournoi pour trancher ?
 *
 * Non quand la réponse est déjà acquise sans elles — pas de tag, lecteur
 * titulaire, tag visible, lecteur anonyme : une requête de plus sur chaque fiche
 * consultée n'aurait servi à personne.
 */
export function battletagNeedsTournamentContext(
  tag: string | null | undefined,
  viewer: BattletagViewer | null | undefined,
  subject: Pick<BattletagSubject, "userId" | "visible">,
): boolean {
  if (!tag || !viewer) return false;
  // Dérivé de la règle elle-même, faits de tournoi à faux : si elle répond déjà
  // oui sans eux, les demander ne changerait rien.
  return !canViewBattletag(viewer, { ...subject, sharesLiveMatch: false, inActiveTournament: false });
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
