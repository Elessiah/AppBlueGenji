# Membres d'une équipe : invitations, « Mes rôles », tableau des rôles

Section « Membres » de la fiche `/equipes/[id]`
(`app/(secured)/equipes/[id]/_components/MembersSection.tsx`). Un joueur avait
coché les pastilles de rôles du formulaire d'invitation pour se donner les
siens : rien n'était enregistré. Les deux gestes sont désormais séparés.

## Invitation en deux temps

- Le formulaire de la page ne garde que le **pseudo** et « Inviter ».
- « Inviter » ouvre `InviteRolesDialog` (portail `TeamDialog` : `useDialogBehavior`,
  `useBackdropDismiss`) : le tableau des rôles, **aucun coché d'avance** ;
  inviter sans rôle est permis (décision D71).
- Pseudo refusé (introuvable, déjà invité…) : la modale se ferme, le refus est
  rattaché au champ (`useFieldErrors`) et notifié, et les rôles cochés sont gardés
  (`keepRoles`) pour la rouvrir ; autre refus : la modale reste ouverte avec sa
  sélection. Entrée sur une case ne soumet jamais (`isCheckboxEnter`, aussi dans
  « Mes rôles »).
- Serveur : `inviteRolesFromBody` — absent → défaut `DPS` (anciens appelants),
  liste (même vide) de codes connus → `OWNER` retiré ; pas un tableau, ou un
  élément qui n'est pas un code de rôle connu (`"PILOTE"`, `3`) → `INVALID_ROLES`
  (400), jamais filtré en silence. Une invitation stockée sans colonne de rôles
  (antérieure), ou dont la liste non vide ne porte aucun code connu (rôle retiré
  depuis), arrive toujours en `DPS` (`invitationRoles` → `null`) ; seule une
  liste vide stockée (`[]`) fait arriver sans rôle.
- Décisions de la modale (fermer, vider le champ) : `invitationOutcome`
  (`app/(secured)/equipes/[id]/_lib/member-roles.ts`).

## « Mes rôles »

- `MyRolesBlock`, montré à tout membre : rôles de direction en pastilles (lecture
  seule), cases `COACH`, `TANK`, `DPS`, `HEAL` (`SELF_ASSIGNABLE_ROLES`, règle
  d'autorisation dans `lib/shared/team-roles.ts`, à côté de
  `hasTeamManagementRole` — un rôle de direction est tout autre rôle,
  `isLeadingRole`),
  « Enregistrer mes rôles » (`aria-disabled` tant que rien ne change), et
  « Ce que fait chaque rôle » (`RoleGuideDialog`, tableau en lecture).
- `PUT /api/teams/[id]/my-roles` `{ roles: string[] }` → `updateOwnGameRoles`
  (`lib/server/teams/roster.ts`) : soi seul, sous le verrou de **sa ligne de membre**
  (`withMemberRowLock`, pas celui de l'équipe : un choix cosmétique ne fait pas
  attendre l'inscription), liste dédoublonnée avant le verrou, aucune écriture si
  rien ne change, conditions acceptées ; un rôle hors jeu → `ROLE_NOT_SELF_ASSIGNABLE` (400),
  hors roster → `NOT_A_MEMBER` (403), conditions → 409. Les rôles de direction
  restent tels quels (`withOwnGameRoles`). Liste absente ou portant un code
  inconnu → `INVALID_ROLES` (`rolesListFromBody`), jamais lue comme « aucun
  rôle ». Réponse : `{ roles }` (rôles enregistrés), pas la fiche ; le client
  relit la fiche seule — les invitations en attente ne changent pas d'un rôle de
  jeu (`useMemberManagement`, `onOwnRolesChanged`).
- La gestion garde la modale « Rôles » sur les autres membres
  (`updateTeamMemberRoles`, `hasTeamManagementRole`, un manager ne touche pas au
  propriétaire). Même liste exigée de codes connus : un code inconnu ne vide plus
  les rôles du membre. Une sélection vide y est désormais permise (`MISSING_ROLE`
  retiré) ; le propriétaire garde toujours `OWNER`.

## Tableau des rôles (`RoleTable`)

Le propriétaire, sans case dans un tableau à cocher, se lit en libellé atténué
(jamais la pastille pleine) ; « Mes rôles » ne se remonte pas à chaque
enregistrement (le focus reste sur le bouton). Rôles ARIA de tableau, une ligne par rôle (`TEAM_ROLE_ORDER`), colonnes « Sur
l'équipe », « En match », « Messages reçus » ; un `<InfoHint>` par rôle (qui le
donne, ce qu'il ne permet pas). Sous 700 px de **largeur du tableau** (`@container roleTable`, la modale
étant bornée à 820 px), chaque ligne se replie en une colonne, cellules libellées par `data-label` (en-têtes gardés pour les
lecteurs d'écran). Textes dans `messages/{fr,en}/team.json` (`roleGuide`,
`myRoles`, `inviteDialog`).

**Les textes suivent le code — un changement de droit ou de destinataire les
change aussi.** Sources :

| Affirmation | Source |
| --- | --- |
| Nom, sigle, description, transfert, dissolution : `OWNER` seul ; logo, invitations, demandes, rôles, exclusions, inscriptions : `OWNER`/`MANAGER` | `docs/AUTHORIZATION_RULES.md` §3.1, `hasTeamManagementRole` (`lib/shared/team-roles.ts`) |
| « Prêt », saisie et confirmation du score : `CAPITAINE`/`MANAGER`/`OWNER` | `canDeclareTeamReady` (`lib/shared/match-launch.ts`), §4.3, §4.9 |
| Forfait d'un match, abandon d'un tournoi : `OWNER`/`MANAGER` | `forfeitOwnMatch` (`lib/server/tournaments/player-forfeit.ts`), §4.7 |
| Vider le salon vocal : `OWNER`/`MANAGER`/`CAPITAINE` | `TEAM_CLEARABLE_CHANNEL_SQL` (`lib/server/tournaments/match-voice.ts`) |
| Premier contact présenté : certifié d'abord, puis capitaine, manager, propriétaire | `pickLaunchContacts` / `roleRank` (`lib/shared/match-launch.ts`) |
| Annonces de match (nouveau match, rappels : DM + push ; départ, coup d'envoi : push) à tous les membres | `loadEntrantPlayerIds` (`lib/server/notify.ts`) |
| Score à confirmer (push) aux meneurs de match | `loadEntrantMatchLeaderIds` |
| Check-in des matchs en autogestion (DM + push) à la gestion | `loadEntrantManagerIds` |
| Demandes d'adhésion (DM + push) à `OWNER`/`MANAGER` | `lib/server/team-join-notifications.ts` |

Tests : `tests/app/team-members-ux.test.tsx`, `tests/lib/server/teams-service.test.ts`
(`updateOwnGameRoles`), `tests/app/api/teams/team-management-routes.test.ts`
(`PUT …/my-roles`), `tests/lib/server/team-invite-roles.test.ts`,
`tests/lib/shared/team-role-display.test.ts`, `tests/lib/shared/team-join.test.ts`.

Performance : le roster est mémorisé (`useMemo`, une frappe du champ pseudo ne le
refait pas), les lignes de `RoleTable` sont mémorisées (cocher n'en refait
qu'une), les trois modales à tableau se chargent à l'ouverture (`next/dynamic`),
un changement de rôles ne relit que la fiche (pas les invitations), `PATCH
…/members` ne rend plus la fiche, et un brouillon de « Mes rôles » modifié à la
main survit à une relecture venue d'ailleurs.
