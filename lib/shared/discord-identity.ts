/**
 * Le tag Discord d'un joueur : qui a le droit de le lire, et à quelle
 * condition.
 *
 * **Pourquoi la règle change.** Un tournoi ne se gère pas sans joindre les
 * joueurs : une manche à reprogrammer, un roster à vérifier, un forfait à
 * confirmer se règlent en message privé, jamais sur une fiche de profil. Le tag
 * Discord était pourtant strictement privé — `getFullProfile` ne le renseignait
 * que pour le propriétaire du compte —, si bien que l'organisation devait le
 * demander à chaque fois, à chaque tournoi, à chaque joueur.
 *
 * **Pourquoi la vérification est la charnière.** Les comptes existants ont saisi
 * ce tag sous le régime « visible de moi seul » : l'exposer rétroactivement
 * serait changer la finalité d'une donnée déjà collectée, sans que personne
 * n'ait rien dit. Un tag **non vérifié garde donc ses propriétés d'origine** —
 * invisible à tous, administrateurs compris. La vérification est le geste par
 * lequel le joueur accepte l'exposition, et elle est facultative : un compte qui
 * ne la fait pas reste exactement dans l'état où il était.
 *
 * Elle sert accessoirement à ce que le tag soit **juste** : rien n'empêchait
 * d'écrire celui d'un autre dans ce champ, et un arbitre qui écrit au mauvais
 * joueur ne le sait pas.
 *
 * **Deux publics, deux portées.** L'administrateur voit tous les tags vérifiés,
 * en tout temps : c'est lui qui répond des données du site et de la modération.
 * L'arbitre ne voit que ceux des joueurs **qu'un tournoi lui donne à arbitrer** —
 * son besoin naît du tournoi et s'éteint avec lui. Le cast (`casting`) n'y a
 * aucun droit : diffuser n'est pas joindre.
 *
 * Module **pur** : aucune requête, aucun accès serveur. Le `sharesTournament`
 * ci-dessous est un fait que l'appelant a déjà établi, pas une question que ce
 * module sait poser.
 */
import { can, type PlatformRole } from "./permissions";
import type { TournamentState } from "./types";

/**
 * Ce tournoi ouvre-t-il l'accès aux contacts de ses engagés ?
 *
 * « Vivant » = tout état sauf `FINISHED`, et la borne est le palmarès : un
 * tournoi clos n'a plus de manche à reprogrammer, donc plus de raison de donner
 * les coordonnées de qui y a joué. C'est la même phrase que
 * `inActiveTournament` ci-dessous, nommée ici une fois pour que les **deux**
 * chemins l'appliquent à l'identique — la fiche d'un joueur (qui la relit en
 * SQL, faute de pouvoir appeler du TypeScript depuis une requête) et le panneau
 * de contacts d'un plateau (qui la lit sur l'état déjà chargé).
 *
 * Contrepartie assumée : l'organisation qui doit joindre quelqu'un après la
 * clôture — remise de lot, litige tardif — passe par la fiche du joueur si un
 * autre tournoi le porte encore, ou par le canal Discord. L'accès s'éteint avec
 * le tournoi, c'est tout le propos.
 */
export function tournamentGrantsContactAccess(state: TournamentState): boolean {
  return state !== "FINISHED";
}

/** Ce que le module a besoin de savoir du **lecteur**. */
export type DiscordTagViewer = {
  id: number;
  isAdmin?: boolean;
  roles?: readonly PlatformRole[];
};

/** Ce que le module a besoin de savoir de la **cible** et de son lien au lecteur. */
export type DiscordTagSubject = {
  /** Compte dont on veut lire le tag. */
  userId: number;
  /** Le tag stocké a-t-il été prouvé par son titulaire ? */
  verified: boolean;
  /**
   * La cible est-elle engagée dans un tournoi encore vivant ?
   *
   * C'est l'appelant qui l'établit (une inscription jointe à un tournoi non
   * terminé), parce que lui seul a la base sous la main. Le fait est **global**,
   * pas relatif au lecteur : un arbitre arbitre le site, pas un tournoi en
   * particulier — lui demander de prouver son affectation tournoi par tournoi
   * n'existe nulle part dans le modèle de permissions.
   */
  inActiveTournament?: boolean;
};

/**
 * Le lecteur peut-il voir le tag Discord de la cible ?
 *
 * L'ordre des cas est la règle elle-même :
 *
 * 1. **soi-même** — toujours, vérifié ou non : c'est sa propre saisie ;
 * 2. **non vérifié** — personne, administrateur compris. C'est la clause qui
 *    protège les comptes d'avant, et elle passe **avant** les rôles pour qu'on
 *    ne puisse pas l'oublier en ajoutant un rôle demain ;
 * 3. **administrateur** — toujours ;
 * 4. **permission `tournaments`** (l'arbitre) — seulement si la cible est
 *    engagée dans un tournoi vivant ;
 * 5. tout le reste — non. Le tag n'est **jamais public** : aucun réglage de
 *    visibilité ne l'ouvre, parce qu'aucun écran public n'en a l'usage.
 */
export function canViewDiscordTag(
  viewer: DiscordTagViewer | null | undefined,
  subject: DiscordTagSubject,
): boolean {
  if (!viewer) return false;
  if (viewer.id === subject.userId) return true;
  if (!subject.verified) return false;
  if (viewer.isAdmin) return true;
  if (can(viewer, "tournaments")) return Boolean(subject.inActiveTournament);
  return false;
}

/**
 * La **certification** est-elle annonçable à ce lecteur ?
 *
 * Oui, toujours — et c'est le point à ne pas confondre avec le tag. Ce sont
 * **deux faits distincts** :
 *
 * - le **tag** dit *comment* joindre le joueur. C'est une coordonnée, filtrée
 *   par `canViewDiscordTag` ;
 * - la **certification** dit seulement *qu'il est joignable* par l'organisation.
 *   Elle ne nomme personne, ne mène à personne, et ne se retourne pas contre son
 *   titulaire : c'est une propriété de son compte, au même titre que son
 *   ancienneté.
 *
 * L'annoncer sert à quelqu'un de précis : le **capitaine** dont le tournoi exige
 * « tous les Discord vérifiés » (`docs/features/REGISTRATION_FILTERS.md`). Sans
 * elle, il lit un refus qui nomme la condition sans jamais lui dire **qui** de
 * son roster doit encore certifier — un mur sans poignée.
 *
 * D'où la forme retenue à l'affichage : « Masqué ✅ ». Le tag reste secret, la
 * pastille dit le reste. Une fonction plutôt qu'une constante `true` : c'est
 * l'endroit où l'on viendra la restreindre si elle devait l'être un jour, et le
 * seul endroit.
 */
export function canSeeDiscordVerification(): boolean {
  return true;
}

/**
 * Le tag tel qu'il doit sortir, ou `null`.
 *
 * Posé **à la sortie**, comme `visibleAvatarUrl` : une colonne se lit par les
 * fonctions qui la sérialisent, alors qu'elle se remplit par des chemins qu'on
 * oublie d'énumérer. Rendre `null` plutôt que de laisser l'appelant décider
 * garantit qu'un écran ajouté demain ne peut pas afficher ce qu'il n'a pas le
 * droit de lire : il n'a rien à afficher.
 */
export function visibleDiscordTag(
  tag: string | null | undefined,
  viewer: DiscordTagViewer | null | undefined,
  subject: DiscordTagSubject,
): string | null {
  if (!tag) return null;
  return canViewDiscordTag(viewer, subject) ? tag : null;
}

/**
 * Le tag est-il **vérifiable en un clic** ?
 *
 * Un compte né par Discord — ou qui s'y est déjà rattaché — a **déjà** prouvé
 * son identifiant : il l'a fait en ouvrant sa session, par le code reçu en
 * message privé. Lui redemander un code pour le même compte serait rejouer une
 * preuve qu'on détient. Le site se contente alors de vérifier que le tag saisi
 * **désigne cet identifiant-là** (résolution par le bot), et certifie sur
 * place.
 *
 * Le second cas — aucun identifiant lié — est celui d'un compte Google : la
 * preuve n'existe pas encore, il faut la faire, donc un code.
 */
export function discordVerificationNeedsCode(linkedDiscordId: string | null | undefined): boolean {
  return !linkedDiscordId;
}

/**
 * Ce que la certification expose, dit au joueur **avant** qu'il la demande.
 *
 * Une liste, et non un paragraphe : chaque ligne est un public et une portée,
 * c'est exactement ce qu'un consentement doit énoncer. Elle vit ici, avec la
 * règle qu'elle décrit — une copie dans le dialogue aurait dérivé de
 * `canViewDiscordTag` au premier ajustement, et le joueur aurait consenti à
 * autre chose que ce que le code applique.
 */
export const DISCORD_VERIFICATION_EXPOSURE: readonly string[] = [
  "Les administrateurs du site voient ton tag Discord en permanence.",
  "Les arbitres le voient uniquement quand tu es engagé dans un tournoi en cours ou à venir — plus après.",
  "Personne d'autre : ton tag n'apparaît sur aucune page publique, ni pour les autres joueurs, ni pour les casters.",
  "Tu peux annuler à tout moment en modifiant ton tag : la certification est perdue, et l'exposition avec elle.",
];

/**
 * Pourquoi la certification est demandée, en une phrase.
 *
 * Séparée de la liste : l'une justifie, l'autre énumère. Les écrans qui n'ont la
 * place que d'une ligne prennent celle-ci.
 */
export const DISCORD_VERIFICATION_PURPOSE =
  "L'organisation doit pouvoir te joindre pendant un tournoi : reprogrammation d'une manche, litige de score, forfait.";
