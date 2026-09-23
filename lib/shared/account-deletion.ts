/**
 * Supprimer un compte : **l'effacer** quand il ne laisse rien, l'anonymiser
 * sinon.
 *
 * La suppression n'avait qu'un seul geste — anonymiser : le pseudo devient
 * `compte_supprime_<id>`, les identités et les coordonnées partent, la ligne
 * reste. C'est la bonne réponse pour un joueur qui a **joué** : ses matchs, son
 * palmarès et le bilan de ses équipes se lisent sur des lignes qui le
 * référencent, et l'effacer les emporterait — le classement du site se rejoue
 * depuis `bg_matches`, une équipe perdrait des adversaires, une manche
 * perdrait un engagé.
 *
 * Ce n'est pas la bonne réponse pour un compte **qui n'a rien laissé**. Un
 * joueur inscrit un soir, jamais engagé nulle part, repartait en laissant une
 * ligne « compte_supprime_412 » à l'annuaire pour toujours : rien à préserver,
 * et une trace de son passage qu'il venait précisément de demander d'effacer.
 *
 * D'où deux modes, et **un seul critère** : reste-t-il quelque chose qui
 * référence ce compte et qui doit survivre ?
 *
 * Module **pur** : les traces sont des faits que l'appelant a déjà établis en
 * base. Le partage compte — l'écran qui prévient et le service qui écrit
 * doivent dire la même chose, sans quoi la confirmation annonce une suppression
 * complète là où le serveur anonymise.
 */

/**
 * Ce qu'un compte laisse derrière lui.
 *
 * Trois traces, et aucune n'est décorative :
 *
 * - `tournaments` — il a été **engagé** dans un tournoi, par une équipe ou par
 *   une entrée solo. C'est la trace que l'entrée d'`ERREUR.txt` nomme : elle
 *   porte des matchs, donc un classement, donc des points chez les autres.
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
  tournaments: boolean;
  organizedTournaments: boolean;
  ownedTeams: boolean;
};

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
 * mieux que les deux autres — c'est elle qui appartient aussi à d'autres —,
 * puis l'organisation, puis la propriété d'une équipe, qui est la seule que le
 * joueur puisse lever lui-même.
 */
export function accountRetentionReason(trace: AccountTrace): AccountRetentionReason | null {
  if (trace.tournaments) return "TOURNAMENTS";
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
  const irreversible = "Cette action est irréversible.";
  switch (reason) {
    case "TOURNAMENTS":
      return `Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais tes statistiques de tournoi resteront conservées — elles appartiennent aussi aux équipes que tu as affrontées. ${irreversible}`;
    case "ORGANIZED_TOURNAMENTS":
      return `Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais ta ligne restera : tu es l'organisateur de tournois qui doivent garder un titulaire. ${irreversible}`;
    case "OWNED_TEAMS":
      return `Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais ta ligne restera : tu es propriétaire d'une équipe, que personne ne pourrait plus gérer sans toi. Transfère-la ou dissous-la d'abord pour un effacement complet. ${irreversible}`;
    case null:
      return `Supprimer définitivement ton compte ? Tu n'as participé à aucun tournoi et ne gères ni équipe ni tournoi : ton compte sera effacé entièrement, sans laisser de trace sur le site. ${irreversible}`;
    default:
      return `Supprimer définitivement ton compte ? Le site n'a pas pu dire ce qu'il en restera : selon ce que tu as laissé (tournoi joué, équipe possédée, tournoi organisé), il sera rendu anonyme ou effacé entièrement. ${irreversible}`;
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
      return "Compte supprimé. Tes statistiques restent conservées de façon anonyme.";
    case "ORGANIZED_TOURNAMENTS":
      return "Compte supprimé. Tes tournois gardent un organisateur anonyme.";
    case "OWNED_TEAMS":
      return "Compte supprimé. Ton équipe garde un propriétaire anonyme.";
    case null:
      return "Compte effacé. Il ne reste aucune trace de ton passage sur le site.";
    default:
      return "Compte supprimé.";
  }
}

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
 * **Elle ne traduit que celui-là.** Tout autre code ressort **tel quel**, et le
 * `fallback` ne sert qu'à son absence : la fonction reprend exactement
 * l'idiome `payload.error || FALLBACK` qu'elle remplace, elle ne le corrige pas.
 * Dire qu'elle « laisse les autres codes au repli de l'appelant » serait faux,
 * et c'est une inexactitude qui compte ici : elle ferait croire que plus aucun
 * code en capitales ne peut atteindre un toast, alors que `PSEUDO_ALREADY_USED`
 * y arrive encore. Ces chemins-là sont un défaut préexistant, conséquence de
 * l'absence d'un registre d'erreurs pour `/profil` ; les couvrir demanderait une
 * phrase par code, ce que la suppression de compte n'avait pas à écrire.
 */
export function accountDeletedWriteMessage(code: string | undefined, fallback: string): string {
  if (code === ACCOUNT_DELETED_ERROR) {
    return "Ce compte vient d'être supprimé : la modification n'a pas été enregistrée.";
  }
  return code || fallback;
}
