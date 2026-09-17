# Retirer un engagé d'un tournoi

> `lib/shared/entrant-removal.ts` (pur) · `lib/server/tournaments/registration-removal.ts` ·
> `DELETE /api/admin/tournaments/[id]/registrations/[teamId]`

## Le manque

Une inscription ne se défaisait pas. Une fois posée, la ligne restait jusqu'au
coup d'envoi : un joueur engagé par erreur, une équipe fantôme cochée une fois de
trop dans un lot de trente, un capitaine qui prévient la veille qu'il ne viendra
pas — le plateau les gardait tous.

La seule sortie existante est l'**abandon** (`POST .../forfeit`), et elle ne
convient pas :

- elle exige que le tournoi soit **en cours** (`TOURNAMENT_NOT_RUNNING` sinon) ;
- elle n'est ouverte qu'à trois formats (Survie, Ronde suisse, BG Survie) ;
- elle laisse l'engagé **au classement**, avec un forfait à son nom.

Pour un tournoi qui n'a pas commencé, c'est écrire une défaite là où il n'y a
jamais eu de match — et, sur un plateau complet, c'est surtout une place qui ne
se rend pas.

## La règle

> Le staff `tournaments` retire un engagé **jusqu'au début du tournoi**, pas une
> seconde de plus. L'inscription est **effacée**.

La borne n'est pas une prudence, c'est la seule qui se tienne. Au coup d'envoi le
tirage est fait : le plateau, les classements de départ et les appariements de la
première manche descendent tous de la liste des inscrites. En retirer une après
coup laisserait un match sans adversaire et un classement qui compte un absent —
c'est justement ce que l'abandon sait faire, à sa place et avec ses règles.
Avant, rien de tout cela n'existe : il n'y a qu'une ligne d'inscription.

Corollaire utile : **ce module n'a aucun nettoyage à faire**. Ni match, ni
classement, ni phase, ni rappel de match — ils naissent tous à la bascule
`REGISTRATION → RUNNING`, que la fenêtre refuse de franchir. Une suppression qui
ne supprime qu'une ligne est une suppression qu'on peut relire.

## La fenêtre, et ses deux lectures de l'état

`entrantRemovalBlockReason` consulte l'état **stocké** *et* l'état **calculé**,
exactement comme `launchBlockReason` (`lib/shared/tournament-launch.ts`) et pour
la même raison — c'est la même paire de sources :

| Source | Ce qu'elle rattrape |
| --- | --- |
| `bg_tournaments.state` | un tournoi lancé par anticipation, ou clos à la main, avant l'heure inscrite au calendrier. |
| `computeTournamentState` | un tournoi dont l'heure de début est **passée** sans que la colonne ait été recalée. |

Ne consulter que la première laisserait retirer un engagé après le coup d'envoi,
au seul motif que personne n'avait encore ouvert la page. Ne consulter que la
seconde rouvrirait la fenêtre sur un tournoi clos avant terme.

Deux codes de refus, alors que la règle est unique, parce qu'un tournoi terminé
s'entend dire qu'il est terminé et non qu'il vient de commencer :

- `ENTRANT_REMOVAL_TOURNAMENT_STARTED` → 409
- `ENTRANT_REMOVAL_TOURNAMENT_FINISHED` → 409

Les **phrases françaises vivent dans le module pur** : l'interface les affiche
sous la liste quand elle ferme le bouton, `error-map.ts` les reprend telles
quelles par `...ENTRANT_REMOVAL_BLOCK_MESSAGES` pour le toast. Une seule
formulation, du module jusqu'à l'écran.

## Le geste côté serveur

`removeTournamentEntrant(tournamentId, teamId)`, en une transaction :

1. **`lockTournamentRow` en toute première instruction.** Sous `REPEATABLE READ`,
   c'est la première lecture *ordinaire* qui fige l'instantané, et une lecture
   verrouillante n'en crée pas : une lecture placée avant le verrou ferait
   décider la fenêtre sur un état d'avant l'attente. Même piège, même remède
   qu'à l'inscription (`./registration.ts`), d'où le partage de la fonction.
2. **`syncTournamentState`**, puis la règle. L'entretien d'abord : sans lui, un
   tournoi dont l'heure de début est passée reste `REGISTRATION` en base tant que
   personne n'a ouvert sa page. La synchronisation le lance ici, dans cette même
   transaction, et la règle le refuse aussitôt.
3. Le **nom de l'engagé** est lu avant l'effacement (`JOIN bg_teams`) : il
   voyage jusqu'à la ligne de journal, où il est la seule trace qui subsiste.
4. `DELETE FROM bg_tournament_registrations`.
5. **`resequenceSeeds`** (`./seeding.ts`) : retirer le troisième de huit ne
   laisse pas la suite en 4, 5, 6, 7, 8. Rien ne s'en casserait — tout le moteur
   lit ces rangs par `ORDER BY` — mais la colonne cesserait de dire ce qu'elle
   promet. La renumérotation vit dans `seeding.ts`, où vit la règle d'ordre.
   Elle ne touche **pas** `manual_seeding` : refermer un trou n'est pas un ordre
   choisi par le staff.
6. `publishUpdatedEvent` après le commit — le panneau d'inscriptions et l'aperçu
   du plateau se refont par le flux SSE.

### Ce qui n'est pas supprimé

**Aucune équipe, aucun joueur.** Ni la fantôme qu'on vient de retirer du plateau
(elle resservira au prochain tournoi), ni l'entrée solo d'un joueur, qui est son
identité d'engagé et non une inscription. Même règle que
`docs/features/TOURNAMENT_DELETION.md`.

## Droits

Permission `tournaments` — administrateur **ou** arbitre, comme l'arbitrage des
scores et le retour en arrière : c'est le même métier, tenir un plateau. La
suppression définitive d'un tournoi reste le seul geste du domaine à exiger
`isAdmin`, parce qu'elle seule est sans retour ; une inscription retirée par
erreur se repose, le tournoi étant par construction encore ouvert.

Un engagé à la fois, pas un lot : le refus d'un lot devrait nommer celui qui a
bloqué (`docs/features/GHOST_TEAMS.md`), et le geste inverse — cocher trente
fantômes d'un coup — n'a pas d'équivalent ici, où l'on retire une ligne qu'on
vient de regarder.

## Journal Discord

Une ligne au **journal**, jamais au canal arbitre : c'est le staff qui vient de
faire le geste, il n'a rien à se faire demander.

Elle part de la route par `sendBotLog`, et non par la file transactionnelle
(`queueBotLog`), pour la même raison que la suppression d'un tournoi et le retour
en arrière : **l'auteur est nommé**, et une entrée de la file n'est qu'un renvoi
vers une ligne de la base — elle ne connaît pas l'appelant. Le service a déjà
commité quand la route écrit, donc rien n'est annoncé qui n'ait été écrit ; et
l'échec de l'envoi est avalé, le bot étant optionnel.

```
Inscription retirée — « BlueGenji Open » (#42) : Team Nova, par Kerya (#7). 15/16 équipes.
```

Distincte de l'abandon, et ce n'est pas une nuance de vocabulaire : un abandon
laisse un engagé au classement avec un forfait à son nom, un retrait l'efface —
après coup, **rien sur la page ne dira qu'il a été inscrit**. Le canal est alors
le seul endroit où la trace subsiste.

## Interface

Le bouton vit **sur la ligne de l'engagé**, dans le bloc « Inscriptions · ordre
de départ » (`RegistrationsPanel.tsx`), à côté des flèches de réordonnancement :
c'est la liste qu'on regarde quand on cherche qui retirer.

Deux fenêtres, une cellule. L'ordre de départ reste réglable jusqu'à la première
saisie de score — donc encore **après** le coup d'envoi —, le retrait s'arrête au
coup d'envoi. Les deux commandes partagent la cellule d'actions mais pas la
condition, d'où trois gabarits de grille exclusifs (`.row`, `.withActions`,
`.reorderable`) et un intitulé de colonne qui nomme ce qu'elle contient
réellement : « Ordre », « Retrait », ou « Actions ».

Quand la fenêtre est fermée, le bouton disparaît **et la phrase du module pur
prend sa place** sous la liste : rien sur la ligne ne dirait pourquoi.

Le bouton ouvre une confirmation (`RemoveEntrantDialog.tsx`) — pas de recopie du
nom, contrairement à la suppression d'un tournoi : rien n'est détruit, et
l'engagé peut se réinscrire l'instant d'après. Mais le bouton voisine des flèches
à trente-deux pixels d'un geste anodin, et la confirmation nommant l'engagé est
ce qui distingue les deux. Elle dit les deux choses qu'on ne devine pas : que
l'inscription est **effacée** (à la différence d'un abandon) et que la **place
est rendue** — souvent la raison même du geste, sur un plateau complet dont on
attend un désistement.

## Tests

| Fichier | Ce qu'il tient |
| --- | --- |
| `tests/lib/shared/entrant-removal.test.ts` | la fenêtre : les deux lectures de l'état, la borne au coup d'envoi bornes comprises, les phrases. |
| `tests/lib/server/entrant-removal-service.test.ts` | l'ordre des instructions (verrou d'abord), le refus hors fenêtre, l'effacement, la renumérotation, la publication. |
| `tests/app/api/entrant-removal-route.test.ts` | les gardes de la route et la traduction des refus en statuts. |
| `tests/app/entrant-removal-panel.test.ts` | le câblage de l'interface : bouton sous sa propre condition, phrase de repli, gabarits de grille. |

## Voir aussi

- `docs/AUTHORIZATION_RULES.md` §4.4 et §4.7
- `docs/features/SEEDING_ORDER.md` — la colonne `seed` et sa fenêtre
- `docs/features/TOURNAMENT_DELETION.md` — le geste du cran au-dessus
- `docs/features/UNDERFILLED_TOURNAMENTS.md` — ce qui arrive à un plateau vidé
