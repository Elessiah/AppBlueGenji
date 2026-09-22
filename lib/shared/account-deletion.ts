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
 * La phrase de confirmation, qui doit **décrire ce qui va se passer**.
 *
 * Une seule phrase servait aux deux cas et promettait la conservation des
 * statistiques à des comptes qui n'en ont aucune. Chaque motif a donc la
 * sienne, et celles qui nomment une conservation levable disent **le geste qui
 * la lève** : on ne refuse pas un effacement complet à quelqu'un sans lui dire
 * ce qui l'ouvrirait.
 */
export function accountDeletionConfirmation(
  reason: AccountRetentionReason | null,
): string {
  const irreversible = "Cette action est irréversible.";
  switch (reason) {
    case "TOURNAMENTS":
      return `Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais tes statistiques de tournoi resteront conservées — elles appartiennent aussi aux équipes que tu as affrontées. ${irreversible}`;
    case "ORGANIZED_TOURNAMENTS":
      return `Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais ta ligne restera : tu es l'organisateur de tournois qui doivent garder un titulaire. ${irreversible}`;
    case "OWNED_TEAMS":
      return `Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais ta ligne restera : tu es propriétaire d'une équipe, que personne ne pourrait plus gérer sans toi. Transfère-la ou dissous-la d'abord pour un effacement complet. ${irreversible}`;
    default:
      return `Supprimer définitivement ton compte ? Tu n'as participé à aucun tournoi et ne gères ni équipe ni tournoi : ton compte sera effacé entièrement, sans laisser de trace sur le site. ${irreversible}`;
  }
}

/** Le message rendu une fois la suppression faite. */
export function accountDeletionOutcome(
  reason: AccountRetentionReason | null,
): string {
  switch (reason) {
    case "TOURNAMENTS":
      return "Compte supprimé. Tes statistiques restent conservées de façon anonyme.";
    case "ORGANIZED_TOURNAMENTS":
      return "Compte supprimé. Tes tournois gardent un organisateur anonyme.";
    case "OWNED_TEAMS":
      return "Compte supprimé. Ton équipe garde un propriétaire anonyme.";
    default:
      return "Compte effacé. Il ne reste aucune trace de ton passage sur le site.";
  }
}
