# Tournoi sans adversaires : clôture au coup d'envoi

Un tournoi qui atteint son heure de début avec **zéro ou une seule engagée** ne
passe pas « en cours » : il est **clos immédiatement**, et son unique engagée,
s'il y en a une, est déclarée première.

## Pourquoi la règle vit au-dessus des formats

Un tournoi se termine quand ses matchs se terminent. Un plateau à moins de deux
engagées n'en produit aucun : passé en `RUNNING`, il y resterait indéfiniment,
sans rien à jouer ni à clore.

Chaque format s'en sortait à sa manière — l'élimination dans
`createBracketIfMissing`, la Survie, la Ronde suisse et « BlueGenji Survie » dans
leur réconciliation — sauf **à zéro engagée** : là, `reconcileSwiss` et
`reconcileEndurance` abandonnent sur un classement vide, et leur tournoi restait
« en cours » pour toujours. Plutôt qu'une rustine de plus par format, la règle
est remontée d'un cran, là où un seul contrôle vaut pour tous les formats
présents et à venir.

## Où le contrôle est posé

`finalizeUnderfilledTournament` (`lib/server/tournaments/finalization.ts`) compte
les inscriptions (`LIMIT 2` : seul « moins de deux » nous intéresse), pose
`final_rank = 1` sur l'unique engagée le cas échéant, puis écrit `state =
'FINISHED'`, `finished_at = NOW()` et `bracket_size` = l'effectif retenu — une
taille laissée à `NULL` redemanderait une synchronisation à chaque lecture
(`loadMaintainedRow`).

`syncTournamentState` (`lib/server/tournaments/state.ts`) l'appelle **avant toute
initialisation de format** : aucun moteur ne sème de classement, de manche ou de
phase pour un tournoi qui n'aura jamais de match.

Le contrôle porte sur l'état **calculé**, pas sur la seule bascule depuis les
inscriptions, pour deux raisons :

- entre la clôture des inscriptions et l'heure de début, un tournoi repasse par
  `UPCOMING` (`computeTournamentState`) : la bascule réelle vers `RUNNING` part
  le plus souvent de là, pas de `REGISTRATION` ;
- un tournoi **déjà** `RUNNING` — état hérité d'avant cette règle, ou écrit à la
  main — doit être rattrapé de la même façon.

C'est sûr dans les deux cas : une inscription n'est jamais retirée (aucune route
ne les supprime, un forfait n'efface rien), donc en compter moins de deux
signifie toujours que rien n'a pu commencer. La clôture remonte
`stateChanged: true`, ce qui invalide la liste publique et pousse l'instantané
aux abonnés du direct comme n'importe quelle bascule.

## Ce que voit le lecteur

La page du tournoi affiche « Terminé », la frise de progression est au bout
([TOURNAMENT_PROGRESS](TOURNAMENT_PROGRESS.md)), et la zone des matchs annonce
« Tournoi clos sans être joué : moins de deux équipes engagées au coup
d'envoi. » plutôt que l'« Aucun match disponible pour l'instant » d'un tournoi
qui attend encore son plateau.

## À savoir

- La branche `registeredTeamIds.length <= 1` de `createBracketIfMissing` reste en
  place : elle sert encore de garde-fou pour un plateau construit hors
  synchronisation, et son cas `phaseId > 0` (une **phase** dégénérée, qui ne clôt
  jamais le tournoi elle-même) n'est pas concerné par cette règle.
- Un tournoi multi-phases sous-rempli **au niveau du tournoi** est clos ici ;
  sauter une *phase* trop petite reste l'affaire de `resolvePhasePlan`
  ([MULTI_PHASE_TOURNAMENTS](MULTI_PHASE_TOURNAMENTS.md)).
- Jeu de test : « Départ Sans Inscrit » (Ronde suisse, 0 engagée) et « Départ à
  Une Seule Engagée » (BlueGenji Survie, 1 engagée) sont insérés « en cours » et
  sans match — le seed ne simule rien en dessous de deux engagées — puis clos par
  la première synchronisation. C'est le contrôle en conditions réelles de la
  règle.
- Tests : `tests/tournois/underfilled-finalization.test.ts` (la clôture
  elle-même) et `tests/tournois/underfilled-start.test.ts` (son déclenchement
  dans la synchronisation).
