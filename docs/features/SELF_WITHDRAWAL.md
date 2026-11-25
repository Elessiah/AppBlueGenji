# Se désinscrire d'un tournoi

> `lib/server/tournaments/registration-removal.ts` (`withdrawOwnRegistration`) ·
> `DELETE /api/tournaments/[id]/register` ·
> `app/(secured)/tournois/[id]/_lib/register-entry.ts` (`canWithdrawOwnEntry`) ·
> bouton de `TournamentHeader`

## Le manque

Un joueur ne pouvait pas défaire son inscription : seul le staff retirait un
engagé (`ENTRANT_REMOVAL.md`), et la confirmation d'inscription prévenait
qu'il n'y aurait pas de retour. Il n'y avait aucun bouton à trouver, donc aucun
moyen de rendre une place qu'on savait ne pas pouvoir tenir.

## La règle

> Le joueur désinscrit **son** engagé jusqu'au **coup d'envoi**, avec la qualité
> qu'il faut pour l'inscrire.

- **Qui** : en tournoi par équipes, le `OWNER` ou un `MANAGER` de l'équipe active
  (`hasTeamManagementRole`), comme pour l'inscription ; un capitaine ou un joueur
  du roster reçoit `403 NOT_TEAM_MANAGER`. En individuel, le joueur lui-même
  (entrée solo).
- **Quand** : la fenêtre du retrait par le staff, `entrantRemovalBlockReason`
  (`lib/shared/entrant-removal.ts`) — jusqu'au début du tournoi, bornes
  comprises. Après, la seule sortie est l'abandon. Refus en `409`.
- **Quoi** : la ligne d'inscription est **effacée** et les rangs se referment
  (`withdrawRegistrationOn`), exactement comme un retrait par le staff ; aucune
  équipe n'est supprimée. L'engagé peut se réinscrire tant que les inscriptions
  restent ouvertes et qu'il reste une place.
- **Conditions d'utilisation** : non exigées — on ne retient pas une équipe dans
  un tournoi faute d'une case cochée.

## Le serveur

`withdrawOwnRegistration` partage le tronc du retrait par le staff
(`runEntrantRemoval`) : verrou du tournoi en toute première instruction,
synchronisation de l'état, règle de la fenêtre, lecture de la ligne
d'inscription, effacement, commit, `publishUpdatedEvent`.

Deux ajouts, avant la première lecture ordinaire :

1. le type de participant est relu par une lecture verrouillante ;
2. en tournoi par équipes, la ligne de l'équipe active (lue sur le pool avant la
   transaction, comme l'inscription) est verrouillée — ordre tournoi → équipe,
   celui de l'inscription. Les rôles sont donc relus à l'instant de l'écriture :
   un manager rétrogradé pendant l'attente ne retire plus rien. Une équipe active
   qui a changé entre-temps rend `CONCURRENT_UPDATE_RETRY` (409) : le joueur a
   une équipe, un nouvel essai tranche.

Un `ROLLBACK` raté garde l'erreur d'origine et détruit la connexion au lieu de
la rendre au pool avec le verrou du tournoi (`rollbackKeepingError`,
`releaseWithServerLockWait`) — pour le retrait par le staff comme pour celui-ci.

Codes : `NO_ACTIVE_TEAM` (400), `NOT_TEAM_MANAGER` (403), `TOURNAMENT_NOT_FOUND`
/ `TEAM_NOT_IN_TOURNAMENT` (404), `ENTRANT_REMOVAL_TOURNAMENT_*` et
`CONCURRENT_UPDATE_RETRY` (409),
`WITHDRAWAL_FAILED` (500, sans le texte de l'erreur).

## Journal Discord

Après le commit, au meilleur effort, une ligne dans la catégorie
`registrations` (`formatEntrantWithdrawnLog`) :
`➖ Désinscription — « Tournoi » (#id) : Team Nova se retire. 15/16 équipes.`
En individuel, l'engagé y est « un joueur » (`entrantLabel`) : aucun pseudo ne
part sur Discord. Le registre (T05) nomme les désinscriptions parmi les faits
journalisés ; aucune donnée, aucun destinataire ni aucune durée nouvelle,
donc pas d'entrée `PRIVACY_CHANGES`.

## L'interface

Le bouton **« Désinscrire mon équipe »** / **« Me désinscrire »** prend, dans
l'en-tête, la place du bouton d'inscription (l'un exclut l'autre). Il porte la
variante `danger` de `CyberButton` : saumon des erreurs (`--danger`), jamais le
rouge du direct ni l'ambre des avertissements. Il n'apparaît que si
`canWithdrawOwnEntry` est vrai — engagé du lecteur inscrit, `canRegisterEntrant`,
coup d'envoi pas encore passé — et jamais sur une page figée. Ces champs sont
déjà portés par les deux portes du contexte du lecteur (flux et REST).

Le clic ouvre un `ConfirmActionDialog` (ton `danger`) qui dit que la place est
libérée et qu'on peut se réinscrire tant que les inscriptions sont ouvertes —
ou, une fois closes (la fenêtre court jusqu'au coup d'envoi), que la
désinscription est définitive (`withdrawalBodyKey`) ; le succès et les refus
passent par les toasts.

La confirmation d'inscription annonce désormais la désinscription possible
jusqu'au coup d'envoi (FR et EN).

## Tests

`tests/lib/server/self-withdrawal-service.test.ts`,
`tests/app/api/tournaments/register.test.ts` (DELETE),
`tests/lib/shared/bot-logs.test.ts`, `tests/tournois/register-entry.test.ts`,
`tests/components/cyber-button-danger.test.tsx`,
`tests/app/tournament-actions-i18n.test.tsx` (bouton en anglais, page figée).
