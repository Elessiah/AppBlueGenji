# Prod d'un match

La **prod** assure la production du direct d'un match. Elle fait partie du cast
du match, **distincte des casters** : elle n'est jamais comptée comme caster, ne
tient ni stream ni antenne, et ne paraît pas dans les contacts du lancement
(elle n'est pas présentée aux équipes).

## Modèle

- `bg_matches.prod_user_id` (`BIGINT NULL`, index `idx_bg_matches_prod`, clé
  étrangère `fk_bg_matches_prod` `ON DELETE SET NULL`) : **une prod au plus** par
  match. Écrite dans le `CREATE TABLE` et dans `RECENT_SCHEMA_CHANGES`.
- Instantané : `BracketMatch.prod` (`{ userId, pseudo } | null`, `mapMatchProd`) ;
  la vue spectateur masque son id comme celui des casters.
- Contexte du lecteur : `TournamentViewerContext.canProd` (`can(user, "prod")`)
  et `canLeaveProd` (`sessionHolds(user, "prod")` : vrai hors incarnation sans
  `prod`, rôle perdu compris), câblés sur les **deux portes** (flux SSE et REST).

## Permission

`prod` (`lib/shared/permissions.ts`) : rôles `PROD` et `ADMIN`. Elle ne donne
**que** le droit de se placer comme prod d'un match ou de s'en retirer — ni
antenne, ni aperçu du plateau (`PERMISSION_ROLES.md`). Un compte marqué
**invité** du planning la garde (la marque ne retire que `planning`).

## Gestes

| Geste | Qui | Route | Refus |
| --- | --- | --- | --- |
| Se placer | `prod` (session, incarnation comprise) | `POST /api/matches/[id]/prod` | `NOT_PROD` (relu en base), `PROD_SUSPENDED` (compte suspendu), `MATCH_PROD_TAKEN` (place tenue sur le match, ou prod d'un autre compte tenue au planning), `PROD_IS_PLAYER`, `PROD_IS_CASTER`, match joué ou exemption, tournoi pas en cours (`MATCH_NOT_LAUNCHABLE`, staff compris : « Faire la prod » n'est offert que dans un tournoi en cours, `prodClaimOpen` ; le staff place d'avance par sa fenêtre) ou pas encore publié pour qui n'a pas `tournaments` (`MATCH_NOT_FOUND`, jugé **avant** tout autre refus du match, qui trahirait son existence ou son état). Une prod tue (voir « Affichage ») qui tenait la place la rend d'abord (`releaseUnfitProd`) au lieu de la tenir contre celle qui la prend |
| Se retirer | la prod elle-même, même sans le rôle (403 seulement pour une incarnation sans `prod`) | `DELETE /api/matches/[id]/prod` | `NOT_MATCH_PROD` |
| Placer, changer, retirer | staff `tournaments` | `GET`/`PUT /api/admin/matches/[id]/prod` (`{ userId, expectedUserId }` ; `userId` obligatoire, `null` = retirer, absent = 400 `INVALID_USER_ID`) | `PROD_NOT_ELIGIBLE` (le compte visé n'a plus `prod`), `PROD_UNAVAILABLE` (suspendu — libellé neutre « ne peut pas être placé pour l'instant » : le staff des tournois n'apprend pas une suspension), `PROD_IS_PLAYER`, `PROD_IS_CASTER`, `PROD_CHANGED` (la prod a changé depuis l'ouverture de la fenêtre) |

Un caster ne peut pas être la prod du même match (`CASTER_IS_PROD` à
l'inscription de cast quand il est la prod du match, `CASTER_IS_PLANNED_PROD`
quand seul le planning lui tient la ligne PROD,
`PROD_IS_CASTER` dans l'autre sens — caster inscrit, ou
ligne CASTER tenue au planning, confirmée ou posée par le staff). Verrous : ligne du
compte (`LOCK IN SHARE MODE`) puis match (`FOR UPDATE`, sans jointure), puis
lignes du planning relues en lecture courante (`LOCK IN SHARE MODE`) — même ordre
que la confirmation du planning, qui relit la prod du match sous verrou.

Sur la carte, « Plus d'actions » : « Faire la prod » / « Ne plus faire la prod » (confirmé par `ConfirmActionDialog`)
(`canLeaveProd` : toute session hors incarnation sans `prod` — un rôle perdu
n'empêche pas de rendre la place qu'un match lancé a gardée) / « Prod du match » (fenêtre `ProdDialog`, retrait confirmé par
`ConfirmActionDialog`). La page du match l'affiche dans ses faits clés (« Prod »).

Affichage : comme un caster inéligible, une prod qui ne remplit plus la
condition **avant le lancement** (rôle perdu, compte suspendu, joueuse du
match — `prod_unfit`, calculé par la requête du plateau) n'est plus montrée,
jusqu'à ce que l'entretien du lancement (ou une prise de place) la rende ; un
match lancé ou joué la garde. Cela couvre aussi la course « se placer » /
« rejoindre une équipe du match » (l'adhésion ne prend pas le verrou du match ;
le plateau la tait à sa prochaine trame, au plus `SNAPSHOT_TTL_MS` pour une
lecture REST, comme un caster inéligible). L'inscription de cast refuse de même
un tournoi pas encore publié à qui n'a pas `tournaments` — la date de
publication est lue avec le contexte du lancement (`readLaunchContext`, aucune
seconde lecture sous le verrou du match) et jugée par la règle de la fiche
(`isTournamentPublished`), jamais par un `NOW()` SQL.

Chaque geste du staff sur la place (placer, changer, retirer) est nommé dans
les journaux du serveur (`auditStaffAction`, `staffProdAuditLine`), la ligne
Discord restant anonyme.

Coût : la clé `prod` n'est portée que par les matchs qui en ont une (trames
SSE et REST) ; l'entretien relit les comptes des prods en une lecture et leurs
appartenances aux équipes en **deux** lectures pour tous les matchs
(`prodPlayersByMatch`) ; `ProdDialog` ne relit pas la liste des comptes après un
placement réussi (`panelWithProd`) ; la perte du rôle libère les places en
verrouillant seulement les matchs concernés, par id croissant, et ne prévient le
compte qu'**une fois** (une ligne de journal par match).

## Annonces

- Journal du staff (salon des casts) : une ligne **anonyme** (`formatProdChangeLog`,
  🎛️) — placée, retirée, placée par le staff, remplacée, retirée par le staff,
  retirée d'office (rôle perdu, prod « plus disponible » — compte suspendu,
  motif tu —, prod devenue joueuse du match, compte supprimé ou en cours de
  suppression). Aucun pseudo, staff anonyme. Les retraits vont à l'alerte du
  staff (`staff-removal`), le reste au salon des casts.
- Avis au compte que le **staff** place ou retire, ou dont la place est rendue
  d'office avec son motif (rôle perdu, compte qui ne peut plus la tenir pour le
  moment, joueur du match) — jamais à qui agit sur
  sa propre place : message privé de match (tag certifié) et push `MATCH_PROD`.
  Un compte qui vient de perdre `prod` sort de l'audience du sujet : il n'a que
  le message privé (comme un caster qui perd `live`). Module
  `lib/server/tournaments/prod-notices.ts`.

## Planning

Le calcul automatique (provisoire) ne place ni caster ni prod sur un match ; une
ligne `PROD` **confirmée** y place sa prod quand le cast du match est libre
(`CAST_PLANNING.md` § Placement sur le match, journal « Prod placée » sans
nom, avis `PLANNED` « Le planning te place comme prod » sauf à qui se confirme
lui-même), dans un tournoi en cours. Quitter cette ligne `PROD` (désistement,
retrait par le staff) rend aussi la place du match (journal « Prod retirée »,
sauf match joué ; avis `RELEASED` quand c'est le staff) ; un invité sorti du
planning la garde. La prod
placée sur un match paraît au planning comme une ligne `PROD` tenue (source
`CAST`, `entryAssignments`) et fait foi : une seule par match, elle remplace
toute autre ligne `PROD` de l'entrée (proposition provisoire, ou ligne tenue
d'un autre compte) ; une ligne `PROD` tenue d'un autre compte réserve
toutefois la place contre « Faire la prod » (`MATCH_PROD_TAKEN`), tant que ce
compte peut faire la prod (ni effacé, ni suspendu, rôle tenu). Elle
se retire depuis le match (`PLANNING_CAST_MANAGED`). Le planning refuse ce qui
la contredirait — une ligne `PROD` d'un autre compte (`PLANNING_PROD_TAKEN`), une
ligne `CASTER` de la prod (`PLANNING_ROLE_CONFLICT`) — à la pose à la main comme à
la confirmation, la prod du match relue sous verrou (`lockedMatchProds`,
`matchProdRefusal`). Elle compte dans l'historique
de charge (`loadPlanningHistory`).

## Données du compte

- Rôle `prod` perdu (`setUserRoles`) : ses places sur des matchs **pas encore
  lancés** sont rendues (`withdrawLostProdPlaces`), annonce « retirée d'office » ;
  un match lancé (direct en cours) ou joué la garde, comme un caster inéligible.
  Ce retrait verrouille les matchs **après** le compte, l'ordre inverse du
  lancement : `setUserRoles` est rejoué sur interblocage (`retryOnDeadlock`).
- Compte suspendu (`suspendAccount`) : même retrait, dans la transaction de la
  suspension (compte verrouillé d'abord, puis matchs), annoncé `UNAVAILABLE`
  sans motif ; la suspension est rejouée sur interblocage. Au journal du staff
  des tournois, `INELIGIBLE` et `UNAVAILABLE` font la même ligne (« la prod ne
  remplit plus les conditions ») : une suspension n'y est pas reconnaissable.
- « Faire la prod » (`claimMatchProd`) et « Caster » (`claimMatchCast`, sur sa
  propre place) rendent d'abord la place d'une prod qui ne remplit plus la
  condition (`releaseUnfitProd`) ; « Faire la prod » lit le compte de l'autre
  prod sans verrou (vue prise sous le verrou du match), pour ne pas croiser
  l'ordre compte → matchs.
- Avant tout lancement (`releaseUnfitProd`, appelé par `adoptCurrentPairing` —
  « Prêt », lancement forcé, entretien, relance après un retrait), sous le verrou
  du match et tant qu'il n'est pas lancé : la prod qui ne peut plus l'être est
  rendue d'office — rôle perdu (`INELIGIBLE`, rattrape aussi un match lancé puis
  réapparié), compte suspendu (`UNAVAILABLE`), compte effacé (journal
  `ACCOUNT_DELETION`, aucun avis), prod devenue joueuse du match (`JOINED_TEAM`,
  lu dans la même lecture d'équipes que les casters). Lectures courantes
  verrouillées quand un instantané a précédé le verrou (entretien, relance) —
  suspension comprise, relue à part (`lockedSuspendedUserIds`) : la sous-requête
  d'une lecture verrouillée lirait l'instantané. L'entretien verrouille tous ses
  matchs avant de lire, en une fois, les comptes de leurs prods. Annoncée après
  le commit (`queueProdChange`).
- Demande de suppression (anonymisation) : places des matchs à jouer rendues,
  une ligne « retirée d'office » au journal par match (`releasedProdPlaces`) ;
  effacement : toutes (`withdrawUserCasts`). Les tournois concernés sont rediffusés.
- Export : `prodAssignments` (match, tournoi) — `RGPD_DATA_RIGHTS.md`.
- Textes légaux : registre T16 (base, en fin de champ « Base légale » : intérêt légitime, comme le planning T20, opposition par le formulaire de signalement — aucune clause des conditions, qui ne couvrent que les casters), T04 (avis en message privé et push, même intérêt légitime et même interrupteur que l’avis au caster ; prods parmi les personnes concernées), T05 (ligne Discord sans nom ; geste du staff nommé dans pm2 avec les comptes visés), T03 (pseudo sur `/suivre`) ; `/rgpd` FR et EN ; entrée `2026-11-prod-match`.

## Seed

La deuxième manche des cas de lancement a pour prod `Test_Prod2` ; les autres
sont libres pour `Test_Prod` (`docs/seed/SEED_RULES.md`).

Au planning, la prod du match porte le motif « Désigné sur le match » (`MATCH`) ; la poser à la main sur son propre match est refusé (`PLANNING_CAST_MANAGED`). La fenêtre « Prod du match » montre les comptes qui jouent ou castent le match grisés, avec leur raison ; le staff dont la cible a perdu le rôle reçoit `PROD_NOT_ELIGIBLE`.
