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
 * Le mode, à partir des traces. Une seule trace suffit à retenir la ligne.
 *
 * Volontairement **conservateur** : dans le doute on anonymise, parce que les
 * deux erreurs ne se valent pas. Anonymiser à tort laisse une ligne de plus à
 * l'annuaire ; effacer à tort détruit ce que d'autres lisent, et rien ne le
 * défait.
 */
export function accountDeletionMode(trace: AccountTrace): AccountDeletionMode {
  const leavesSomething =
    trace.tournaments || trace.organizedTournaments || trace.ownedTeams;
  return leavesSomething ? "ANONYMIZE" : "ERASE";
}

/**
 * La phrase de confirmation, qui doit **décrire ce qui va se passer**.
 *
 * Une seule phrase servait aux deux cas et promettait la conservation des
 * statistiques à des comptes qui n'en ont aucune. Le joueur qui n'a jamais joué
 * a droit à la vraie réponse : il ne restera rien.
 */
export function accountDeletionConfirmation(mode: AccountDeletionMode): string {
  if (mode === "ERASE") {
    return "Supprimer définitivement ton compte ? Tu n'as participé à aucun tournoi : ton compte sera effacé entièrement, sans laisser de trace sur le site. Cette action est irréversible.";
  }
  return "Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais tes statistiques de tournoi resteront conservées — elles appartiennent aussi aux équipes que tu as affrontées. Cette action est irréversible.";
}

/** Le message rendu une fois la suppression faite. */
export function accountDeletionOutcome(mode: AccountDeletionMode): string {
  if (mode === "ERASE") {
    return "Compte effacé. Il ne reste aucune trace de ton passage sur le site.";
  }
  return "Compte supprimé. Tes statistiques restent conservées de façon anonyme.";
}
