/**
 * Supprimer un compte : **l'effacer** quand il ne laisse rien, l'anonymiser
 * sinon.
 *
 * La suppression n'avait qu'un seul geste — anonymiser : le pseudo devient un
 * pseudo d'emprunt (`lib/shared/anonymous-pseudos.ts`), les identités et les
 * coordonnées partent, la ligne reste. C'est la bonne réponse pour un joueur
 * qui a **joué** : ses matchs, son palmarès et le bilan de ses équipes se
 * lisent sur des lignes qui le référencent, et l'effacer les emporterait — le
 * classement du site se rejoue depuis `bg_matches`, une équipe perdrait des
 * adversaires, une manche perdrait un engagé.
 *
 * Ce n'est pas la bonne réponse pour un compte **qui n'a rien laissé**. Un
 * joueur inscrit un soir, qui n'a jamais disputé un match, repartait en
 * laissant une ligne anonyme à l'annuaire pour toujours : rien à préserver, et
 * une trace de son passage qu'il venait précisément de demander d'effacer.
 *
 * D'où deux modes, et **un seul critère** : reste-t-il quelque chose qui
 * référence ce compte et qui doit survivre ?
 *
 * Module **pur** : les traces sont des faits que l'appelant a déjà établis en
 * base. Le partage compte — l'écran qui prévient et le service qui écrit
 * doivent dire la même chose, sans quoi la confirmation annonce une suppression
 * complète là où le serveur anonymise.
 */
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { entrantRemovalBlockReason } from "@/lib/shared/entrant-removal";
import type { TournamentStateInput } from "@/lib/shared/tournament-state";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
} from "./account-deletion-journal";

/**
 * Ce qu'un compte laisse derrière lui.
 *
 * Quatre traces, et aucune n'est décorative :
 *
 * - `playedMatches` — il a **joué** : un match compté (`playedMatchSql`) de son
 *   entrée solo, ou d'une équipe dont il était membre pendant le tournoi (la
 *   fenêtre d'appartenance des statistiques, `stats-service`). C'est la trace
 *   qui porte des statistiques : un joueur dont l'équipe a été engagée mais
 *   qui n'a jamais disputé une rencontre n'a rien à préserver.
 * - `soloRegistrations` — son **entrée solo est engagée** dans un tournoi
 *   individuel qui a commencé (ou fini), ou figure sur un match : elle porte le
 *   pseudo du joueur comme nom d'engagé, sur un plateau qui ne se réécrit plus,
 *   et l'effacement la laisserait nommer quelqu'un qui n'existe plus. Trace
 *   distincte de la précédente parce que sa phrase l'est : une inscription
 *   jamais jouée ne laisse **aucune** statistique, et la confirmation ne doit
 *   pas en promettre. Une inscription à un tournoi **pas encore commencé**,
 *   sans match, ne retient plus la ligne (décision D12) : elle est retirée avec
 *   le compte (`withdrawableSoloRegistrations`).
 * - `organizedTournaments` — il a **créé** un tournoi. `bg_tournaments`
 *   .`organizer_user_id` est `NOT NULL` en `ON DELETE RESTRICT` : la base
 *   refuserait l'effacement, et un tournoi sans organisateur n'aurait de toute
 *   façon plus de titulaire.
 * - `ownedTeams` — il est `OWNER` d'une équipe vivante. `bg_team_members`
 *   s'efface en cascade, si bien que l'effacer laisserait une équipe sans
 *   propriétaire : personne pour la renommer, la dissoudre ou l'engager.
 *
 * Les deux dernières ne figuraient pas dans la demande et ne sont pas un
 * élargissement : ce sont les cas où « effacer complètement » ne veut rien dire
 * — la base refuse, ou casse quelque chose d'autre.
 */
export type AccountTrace = {
  playedMatches: boolean;
  soloRegistrations: boolean;
  organizedTournaments: boolean;
  ownedTeams: boolean;
};

/**
 * Une inscription de l'entrée solo du compte, telle que la suppression la lit :
 * le tournoi (ses dates, pour la fenêtre de retrait d'un engagé) et la présence
 * d'un match qui nomme l'entrée.
 */
export type SoloRegistrationFact = TournamentStateInput & {
  tournamentId: number;
  teamId: number;
  /** Un match (`bg_matches`, n'importe quel côté) désigne l'entrée. */
  hasMatch: boolean;
};

/**
 * Les inscriptions solo que la suppression **retire** pour effacer le compte
 * (décision D12), ou `null` si l'une d'elles retient la ligne.
 *
 * Une inscription jamais jouée ne laisse rien à préserver tant que le tournoi
 * n'a pas commencé : c'est la fenêtre où le staff peut lui-même retirer un
 * engagé (`entrantRemovalBlockReason`), où aucun match, classement ni phase
 * n'existe encore. Après le coup d'envoi, le plateau est tiré — l'entrée y
 * figure, exemptions et forfaits compris — et l'effacer le réécrirait :
 * l'anonymisation reste la règle. Un match qui nomme l'entrée la retient
 * aussi, quel que soit l'état lu.
 *
 * `locked` est l'ensemble des tournois dont la transaction tient la ligne
 * (`lockTournamentRow`) : une inscription faite dans un autre tournoi pendant
 * la suppression n'est pas couverte par le verrou, elle retient la ligne
 * (règle conservatrice). `null` pour l'aperçu, qui n'écrit rien.
 */
export function withdrawableSoloRegistrations(
  registrations: readonly SoloRegistrationFact[],
  locked: ReadonlySet<number> | null,
  now: number = Date.now(),
): readonly SoloRegistrationFact[] | null {
  const withdrawable = registrations.every(
    (registration) =>
      !registration.hasMatch &&
      (locked === null || locked.has(registration.tournamentId)) &&
      entrantRemovalBlockReason(registration, now) === null,
  );
  return withdrawable ? registrations : null;
}

/** Ce que la suppression fait réellement. */
export type AccountDeletionMode = "ERASE" | "ANONYMIZE";

/**
 * **Ce qui** retient la ligne — pas seulement qu'elle est retenue.
 *
 * Le mode ne suffit pas à parler au joueur. « Tes statistiques de tournoi
 * resteront conservées — elles appartiennent aussi aux équipes que tu as
 * affrontées » est vrai d'un joueur qui a joué, et **faux** de celui qui a
 * seulement créé une équipe ou organisé un tournoi : il n'a aucune statistique
 * et n'a affronté personne. Un motif inapplicable sur un geste irréversible est
 * pire qu'une phrase vague — il fait croire qu'aucun geste ne lèverait la
 * conservation, alors que dissoudre ou transférer son équipe la lèverait.
 */
export type AccountRetentionReason =
  | "TOURNAMENTS"
  | "SOLO_REGISTRATIONS"
  | "ORGANIZED_TOURNAMENTS"
  | "OWNED_TEAMS";

/**
 * Ce que la suppression fera, et pourquoi. Construit **ici** et nulle part
 * ailleurs : le mode se déduit du motif, deux champs calculés séparément
 * pourraient se contredire dans une même réponse.
 */
export type AccountDeletionPlan = {
  mode: AccountDeletionMode;
  /** `null` quand rien ne retient la ligne. */
  reason: AccountRetentionReason | null;
};

/**
 * La trace qui retient la ligne, ou `null` si aucune.
 *
 * L'ordre **est** la règle : une trace de tournoi joué explique la conservation
 * mieux que les autres — c'est elle qui appartient aussi à d'autres —, puis
 * l'inscription solo (le pseudo nomme un engagé, sans statistique), puis
 * l'organisation, puis la propriété d'une équipe, qui est la seule que le
 * joueur puisse lever lui-même.
 */
export function accountRetentionReason(trace: AccountTrace): AccountRetentionReason | null {
  if (trace.playedMatches) return "TOURNAMENTS";
  if (trace.soloRegistrations) return "SOLO_REGISTRATIONS";
  if (trace.organizedTournaments) return "ORGANIZED_TOURNAMENTS";
  if (trace.ownedTeams) return "OWNED_TEAMS";
  return null;
}

/**
 * Le mode, à partir des traces. Une seule trace suffit à retenir la ligne.
 *
 * Volontairement **conservateur** : dans le doute on anonymise, parce que les
 * deux erreurs ne se valent pas. Anonymiser à tort laisse une ligne de plus à
 * l'annuaire ; effacer à tort détruit ce que d'autres lisent, et rien ne le
 * défait.
 */
export function accountDeletionMode(trace: AccountTrace): AccountDeletionMode {
  return accountRetentionReason(trace) === null ? "ERASE" : "ANONYMIZE";
}

/** Le plan complet : ce qui va se passer, et ce qui l'impose. */
export function accountDeletionPlan(trace: AccountTrace): AccountDeletionPlan {
  const reason = accountRetentionReason(trace);
  return { mode: reason === null ? "ERASE" : "ANONYMIZE", reason };
}

/**
 * Ce que l'écran sait du sort du compte quand l'aperçu n'a pas répondu :
 * **rien**.
 *
 * Ce n'est pas un motif de conservation de plus, c'est l'absence de réponse — et
 * elle ne se confond avec aucun des deux modes, l'un promettant qu'une ligne
 * reste et l'autre qu'il ne restera rien.
 */
export const RETENTION_UNKNOWN = "UNKNOWN";

/** Ce que la confirmation a pour décrire le sort du compte. */
export type ConfirmationSubject = AccountRetentionReason | null | typeof RETENTION_UNKNOWN;

/**
 * La phrase de confirmation, qui doit **décrire ce qui va se passer**.
 *
 * Une seule phrase servait aux deux cas et promettait la conservation des
 * statistiques à des comptes qui n'en ont aucune. Chaque motif a donc la
 * sienne, et celles qui nomment une conservation levable disent **le geste qui
 * la lève** : on ne refuse pas un effacement complet à quelqu'un sans lui dire
 * ce qui l'ouvrirait.
 *
 * Le **repli n'est pas l'effacement, et pas davantage l'anonymisation** : c'est
 * la phrase qui ne promet ni l'un ni l'autre. L'écran retombait sur celle de
 * `TOURNAMENTS` quand l'aperçu ne répondait pas, au motif qu'elle promet le
 * moins d'effacement — mais la prudence va ici dans le mauvais sens : le serveur
 * re-décide sur son propre instantané, il peut **effacer entièrement**, et le
 * joueur aurait consenti à devenir anonyme. Sur un geste irréversible, on ne
 * demande pas un accord à une description qui peut être fausse. Le refus de
 * confirmer n'est pas une option non plus : supprimer son compte est un droit,
 * et une requête d'aperçu en échec n'a pas à le suspendre.
 *
 * `default` porte cette phrase — et non celle de l'effacement, la plus
 * définitive des quatre : une valeur qu'on n'attendait pas doit mener à la
 * description la plus prudente, pas à la plus lourde.
 */
export function accountDeletionConfirmation(
  reason: ConfirmationSubject,
): string {
  const irreversible = `${ACCOUNT_DELETION_HANDOVER} ${ACCOUNT_DELETION_WINDOW}`;
  // Ce qui reste de **toute** suppression, effacement complet compris : la
  // phrase disait « sans laisser de trace », et c'était faux.
  const residual = `Comme pour tout compte supprimé, resteront les sauvegardes chiffrées du site (${BACKUP_RETENTION_DAYS} jours), la mention de ta suppression dans le journal qui permet de la rejouer après une restauration (au moins ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours), l'empreinte de mesure d'audience décrite par la politique de confidentialité, tes données de connexion (adresse IP, date, moyen de connexion), que la loi impose de garder ${CONNECTION_LOG_RETENTION_DAYS} jours, les annonces de tes matchs de tournoi individuel publiées dans le salon #live du Discord (et l'alerte de modération d'une annonce bloquée ou signalée par AutoMod), qui gardent ton pseudo jusqu'à leur suppression sur demande, et, si tu es membre du staff, la trace de tes gestes dans les journaux du serveur.`;
  switch (reason) {
    case "TOURNAMENTS":
      return `Supprimer ton compte ? Tes informations personnelles seront effacées et ton pseudo remplacé par un pseudo d'emprunt, mais tes statistiques de tournoi resteront conservées — elles appartiennent aussi aux équipes que tu as affrontées. ${irreversible} ${residual}`;
    case "SOLO_REGISTRATIONS":
      return `Supprimer ton compte ? Tes informations personnelles seront effacées et ton pseudo remplacé par un pseudo d'emprunt, mais ta ligne restera : tu es engagé dans un tournoi individuel déjà commencé ou terminé, où ton pseudo sert de nom d'engagé et sera remplacé par ce pseudo d'emprunt. ${irreversible} ${residual}`;
    case "ORGANIZED_TOURNAMENTS":
      return `Supprimer ton compte ? Tes informations personnelles seront effacées et ton pseudo remplacé par un pseudo d'emprunt, mais ta ligne restera : tu es l'organisateur de tournois qui doivent garder un titulaire. ${irreversible} ${residual}`;
    case "OWNED_TEAMS":
      return `Supprimer ton compte ? Tes informations personnelles seront effacées et ton pseudo remplacé par un pseudo d'emprunt, mais ta ligne restera : tu es propriétaire d'une équipe, que personne ne pourrait plus gérer sans toi. Transfère-la ou dissous-la d'abord pour un effacement complet. ${irreversible} ${residual}`;
    case null:
      return `Supprimer ton compte ? Tu n'as joué aucun match ni laissé de tournoi sans repreneur : ton compte et ton profil seront effacés entièrement, et tes éventuelles inscriptions à des tournois individuels pas encore commencés seront retirées. ${irreversible} ${residual}`;
    default:
      return `Supprimer ton compte ? Le site n'a pas pu dire ce qu'il en restera : selon ce que tu as laissé (match joué, inscription à un tournoi individuel, tournoi organisé), il sera rendu anonyme ou effacé entièrement. ${irreversible} ${residual}`;
  }
}

/**
 * Le message rendu une fois la suppression faite.
 *
 * `null` est ici une **réponse** — « il ne reste rien » —, et c'est pourquoi il
 * porte son propre `case` au lieu d'être laissé au `default` : le repli sert à
 * ce qu'on n'attendait pas, et il ne doit alors promettre ni la conservation ni
 * l'effacement. Même doctrine que `accountDeletionConfirmation`, pour la même
 * raison : de ces deux phrases, celle de l'effacement est la plus définitive,
 * et l'écran ne peut pas l'affirmer sur une valeur qu'il n'a pas comprise.
 */
export function accountDeletionOutcome(
  reason: ConfirmationSubject,
): string {
  switch (reason) {
    case "TOURNAMENTS":
      return "Suppression demandée. Tes statistiques resteront conservées sous un pseudo d'emprunt. Pour l'annuler, reconnecte-toi d'ici 30 jours et confirme la réactivation.";
    case "SOLO_REGISTRATIONS":
      return "Suppression demandée. Tes inscriptions en tournoi individuel porteront un pseudo d'emprunt. Pour l'annuler, reconnecte-toi d'ici 30 jours et confirme la réactivation.";
    case "ORGANIZED_TOURNAMENTS":
      return "Suppression demandée. Tes tournois garderont un organisateur anonyme. Pour l'annuler, reconnecte-toi d'ici 30 jours et confirme la réactivation.";
    case "OWNED_TEAMS":
      return "Suppression demandée. Ton équipe gardera un propriétaire anonyme. Pour l'annuler, reconnecte-toi d'ici 30 jours et confirme la réactivation.";
    case null:
      return "Suppression demandée. Ton compte et ton profil seront effacés ; seules resteront les traces décrites par la politique de confidentialité et son registre (sauvegardes, journal des suppressions, mesure d'audience). Pour l'annuler, reconnecte-toi d'ici 30 jours et confirme la réactivation.";
    default:
      return "Suppression demandée. Pour l'annuler, reconnecte-toi d'ici 30 jours et confirme la réactivation.";
  }
}

/**
 * Refus de `DELETE /api/profile` qui disent que la session ou le compte n'est
 * plus là — typiquement un nouvel essai après une suppression faite dont la
 * réponse s'est perdue (la route a fermé la session). Réessayer n'y changerait
 * rien : l'écran le dit (`deletion.errors.sessionGone`) et recharge la page.
 */
export const SESSION_GONE_CODES: ReadonlySet<string> = new Set(["UNAUTHORIZED", "USER_NOT_FOUND"]);

/**
 * Le refus, en français.
 *
 * La suppression ne peut échouer que de deux façons, et l'une d'elles est une
 * **course** que rien ne ferme : une clé étrangère en `RESTRICT` lit la dernière
 * version commitée, non l'instantané de la transaction, si bien qu'un tournoi
 * créé après la lecture des traces retient une ligne qu'elles disaient libre.
 * Le second essai anonymisera — c'est exactement ce que la phrase invite à
 * faire.
 *
 * Tout code inconnu retombe sur la phrase générique : une notification est lue
 * par un joueur, jamais par le développeur qui a nommé le code.
 */
export function accountDeletionErrorMessage(code: string | undefined): string {
  if (code === "ACCOUNT_STILL_REFERENCED") {
    return "Ton compte a été rattaché à un tournoi ou à une équipe pendant la suppression. Réessaie : il sera alors anonymisé plutôt qu'effacé.";
  }
  return "La suppression du compte a échoué. Réessaie dans un instant.";
}

/**
 * Le code que rendent les écritures refusées parce que la ligne n'est plus
 * vivante — avatar téléversé, profil sauvegardé.
 *
 * Une seule constante pour les deux côtés : le serveur le pose, l'écran le
 * traduit, et la chaîne n'est écrite qu'une fois.
 */
export const ACCOUNT_DELETED_ERROR = "ACCOUNT_DELETED";

/**
 * Une écriture arrivée **après** la suppression du compte, en français.
 *
 * C'est le versant visible de la course que ferment les `is_deleted = 0` de
 * `updateUserAvatar` et `updateOwnProfile` : la requête était légitime au
 * départ, elle ne l'est plus à l'arrivée. Le joueur doit lire pourquoi sa
 * modification n'a pas pris, et non le code interne — toute l'interface est en
 * français.
 *
 * Une **phrase**, et non plus une fonction qui traduisait ce seul code et
 * rendait les autres tels quels : c'est le registre de `/profil`
 * (`app/(secured)/profil/profile-errors.ts`) qui traduit désormais chaque code,
 * celui-ci compris. L'ancienne forme avait un second défaut, plus sournois : la
 * sauvegarde du profil repassait sa phrase dans ce registre, qui ne la
 * reconnaissait pas — et le joueur lisait « La sauvegarde a échoué » à la place
 * de la seule explication juste.
 */
export const ACCOUNT_DELETED_WRITE_MESSAGE =
  "Ce compte vient d'être supprimé : la modification n'a pas été enregistrée.";

/** La question posée par la modale de suppression du compte (son titre). */
export const ACCOUNT_DELETION_QUESTION = "Supprimer ton compte ?";

/** Ce qui se fait dès la demande et que la réactivation ne défait pas (E3, E4). */
export const ACCOUNT_DELETION_HANDOVER =
  "Dès maintenant, tu quitteras tes équipes (la propriété passera à un copropriétaire, sinon à un gérant, sinon à un capitaine, sinon à un autre membre ; seul joueur, l'équipe deviendra fantôme si elle est engagée dans un tournoi pas terminé, sinon elle sera dissoute), tes tournois organisés passeront à un autre membre du staff quand quelqu'un pourra les reprendre, tes inscriptions à des tournois individuels pas encore commencés, tes casts de matchs pas encore terminés, tes désignations d'arbitre et tes invitations et demandes d'adhésion d'équipe en attente seront retirés et tes matchs restants d'un tournoi individuel en cours où tu n'as jamais joué seront perdus par forfait. Réactiver ton compte ne défera pas ces gestes.";

/** La fenêtre de réactivation (E4). */
export const ACCOUNT_DELETION_WINDOW =
  "La suppression deviendra définitive au bout de 30 jours : d'ici là, te reconnecter te permettra de réactiver ton compte. Dès la demande, ton compte sera montré anonyme partout, sans ton pseudo ni ton avatar ; la réactivation te les rendra.";

/**
 * Le corps de la modale : `accountDeletionConfirmation` sans la question, déjà
 * portée par le titre — sinon lue deux fois (nom puis description du dialogue).
 */
export function accountDeletionConsequences(reason: ConfirmationSubject): string {
  const text = accountDeletionConfirmation(reason);
  const prefix = `${ACCOUNT_DELETION_QUESTION} `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

// ─── Suppression réversible 30 jours (ERASURE-D2, décisions E1–E6) ──────────

/**
 * Délai pendant lequel une suppression demandée se défait par une nouvelle
 * connexion (réactivation explicite). Passé ce délai, le compte est effacé ou
 * anonymisé pour de bon (`finalizeDueAccountDeletions`).
 */
export const ACCOUNT_REACTIVATION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fin de la fenêtre de réactivation d'une suppression demandée à `requestedAt`. */
export function reactivationDeadline(requestedAt: Date | string): Date {
  return new Date(new Date(requestedAt).getTime() + ACCOUNT_REACTIVATION_DAYS * DAY_MS);
}

/** Une date relue de la base (`dateStrings`), ou son absence. */
export type StoredDate = Date | string | null;

/** La suppression demandée à `requestedAt` est-elle encore réversible à `now` ? */
export function isReactivationWindowOpen(requestedAt: StoredDate, now: number = Date.now()): boolean {
  if (requestedAt === null) return false;
  const deadline = reactivationDeadline(requestedAt).getTime();
  return Number.isFinite(deadline) && now < deadline;
}

/**
 * Les inscriptions solo retirées **dès la demande** (D12 étendu) : chacune, sans
 * match, à un tournoi pas encore commencé et verrouillé par la transaction —
 * une à une, et non plus « toutes ou aucune » : les autres (tournoi commencé ou
 * terminé) restent, et c'est leur sort à elles qui décide de la ligne au jour 30.
 */
export function soloRegistrationsWithdrawnOnRequest(
  registrations: readonly SoloRegistrationFact[],
  locked: ReadonlySet<number>,
  now: number = Date.now(),
): SoloRegistrationFact[] {
  return registrations.filter(
    (registration) =>
      !registration.hasMatch &&
      locked.has(registration.tournamentId) &&
      entrantRemovalBlockReason(registration, now) === null,
  );
}

/** Un membre d'équipe qui pourrait recevoir la propriété. */
export type TeamSuccessorCandidate = {
  userId: number;
  roles: readonly string[];
  /** Date d'arrivée dans l'équipe : le plus ancien passe devant. */
  joinedAt: Date | string;
  /** Identifiant de la ligne d'appartenance : départage stable à date égale. */
  membershipId: number;
};

/** Rang d'un candidat : `MANAGER` d'abord, puis `CAPITAINE`, puis tout autre membre. */
function successorRank(roles: readonly string[]): number {
  // Un co-propriétaire déjà en place passe devant tout le monde : la propriété
  // ne s'ajoute à personne d'autre (rôles cumulatifs, deux `OWNER` possibles).
  if (roles.includes("OWNER")) return 0;
  if (roles.includes("MANAGER")) return 1;
  if (roles.includes("CAPITAINE")) return 2;
  return 3;
}

/**
 * Le membre qui reçoit l'équipe quand son propriétaire supprime son compte
 * (E3) : un autre `OWNER` s'il y en a (rien ne change pour lui), sinon un
 * `MANAGER`, sinon un `CAPITAINE`, sinon un autre membre ; à rang
 * égal, le plus ancien dans l'équipe, puis la ligne d'appartenance la plus
 * ancienne. `null` : il était seul.
 */
export function pickTeamSuccessor(candidates: readonly TeamSuccessorCandidate[]): TeamSuccessorCandidate | null {
  let best: TeamSuccessorCandidate | null = null;
  for (const candidate of candidates) {
    if (best === null || compareSuccessors(candidate, best) < 0) best = candidate;
  }
  return best;
}

function compareSuccessors(a: TeamSuccessorCandidate, b: TeamSuccessorCandidate): number {
  const rank = successorRank(a.roles) - successorRank(b.roles);
  if (rank !== 0) return rank;
  const joined = new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  if (Number.isFinite(joined) && joined !== 0) return joined;
  return a.membershipId - b.membershipId;
}

/** États où un tournoi est « actif » pour la règle de l'équipe fantôme (E3). */
export const ACTIVE_TOURNAMENT_STATES = ["UPCOMING", "REGISTRATION", "RUNNING"] as const;

/** Ce que devient l'équipe d'un propriétaire qui supprime son compte (E3). */
export type OwnedTeamFate = "TRANSFER" | "GHOST" | "DISSOLVE";

/**
 * Un successeur → la propriété lui passe. Seul joueur : équipe inscrite à un
 * tournoi actif → équipe fantôme (le staff la tient, l'inscription reste) ;
 * sinon dissoute par le chemin de la dissolution (`dissolveTeamOn` : la ligne
 * et l'historique restent sous « Équipe dissoute #id »).
 */
export function ownedTeamFate(input: { hasSuccessor: boolean; registeredInActiveTournament: boolean }): OwnedTeamFate {
  if (input.hasSuccessor) return "TRANSFER";
  return input.registeredInActiveTournament ? "GHOST" : "DISSOLVE";
}

/** Rôles du nouveau propriétaire : `OWNER` en tête, ses rôles gardés. */
export function successorRoles(roles: readonly string[]): string[] {
  return ["OWNER", ...roles.filter((role) => role !== "OWNER")];
}

/** Écran de réactivation d'un compte en attente de suppression (chemin sans préfixe de langue). */
export const REACTIVATION_PATH = "/connexion/reactivation";

/** Refus d'une connexion à un compte en attente de suppression : la page de connexion ouvre l'écran de réactivation. */
export const ACCOUNT_PENDING_DELETION_CODE = "ACCOUNT_PENDING_DELETION";

/** Durée de vie d'un ticket de réactivation (cookie et ligne `bg_account_reactivation_tickets`), en minutes. */
export const REACTIVATION_TICKET_MINUTES = 15;
