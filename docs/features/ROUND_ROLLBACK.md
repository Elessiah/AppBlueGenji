# Retour en arrière — reculer d'une manche, autant de fois qu'il le faut

> `lib/shared/tournament-rollback.ts` (pur) · `lib/server/tournaments/rollback.ts`
> · `POST /api/admin/tournaments/[id]/rollback` ·
> `app/(secured)/tournois/[id]/_components/RollbackRoundDialog.tsx`

## Le problème

Une manche a été saisie sur de mauvais appariements. Ou bien elle a été jouée en
entier avant qu'on s'aperçoive que la manche précédente portait une erreur de
score.

Dans les deux cas, `match-lock` verrouille la manche fautive — **y compris pour
un administrateur** — parce que la manche suivante porte des saisies
(`lib/shared/match-lock.ts`). La règle est bonne : réécrire un résultat amont
changerait les participants d'un match déjà entamé. Mais elle ne laissait qu'un
seul chemin de sortie, effacer les scores un par un dans le bon ordre, sur un
plateau qui peut compter plusieurs dizaines de rencontres — et le dialogue
d'arbitrage n'a même pas de bouton « effacer », il faut passer par un score
neutre puis revenir.

D'où une action unique, dans la zone de danger de la fiche : **effacer le
dernier stade joué**. Elle **se répète** : chaque clic recule d'un cran, du
dernier stade jusqu'au premier, et le tournoi finit par revenir à l'instant de
son coup d'envoi si on va jusqu'au bout. C'est un outil de rattrapage — on
répare une erreur d'une manche ou deux, on ne recommence pas un tournoi — et
c'est pour cela qu'il avance **par pas** plutôt que de proposer un « revenir à
la manche N » qui obligerait à choisir sans rien voir.

## Le stade, et pourquoi ce n'est pas le numéro de manche

Un numéro de manche ne situe un match que dans les formats qui n'en ont qu'une
série. Il ne dit rien en **double élimination** (les deux tableaux se numérotent
chacun de leur côté : « manche 3 » y désigne deux stades sans rapport), rien en
**multi-phases** (chaque phase repart de 1), et il ment sur la **petite finale**
(créée en manche 1 par `bracket-single.ts`, jouée avec la finale).

Un **stade** est donc un couple `(rang de phase, index)`, comparé dans cet
ordre. L'index se lit de deux façons, selon ce que le groupe de matchs d'une
phase donne à voir.

| Groupe | Reconnu à | Index |
| --- | --- | --- |
| **Plateau** | au moins un lien `next_winner_match_id` / `next_loser_match_id` | `maxProfondeur − profondeur`, la profondeur étant le **plus long** chemin jusqu'à une racine du graphe |
| **Classement** | aucun lien | le numéro de manche |

Les deux familles se distinguent **par les liens eux-mêmes**, jamais par le nom
du format. C'est ce qui permet au module de traiter un tournoi multi-phases sans
rien connaître de ses phases, et à un format ajouté demain d'entrer dans la
règle sans une ligne — les trois modes à classement n'ont pas de liens, l'arbre
final de la BlueGenji Survie non plus.

### Ce que le graphe donne, et que les numéros ne donnaient pas

En **élimination simple**, l'index redonne exactement le numéro de manche — et
range la **petite finale** au stade de la finale sans cas particulier : elle est
une racine du graphe, comme la finale. Le `matchStage` d'avant, qui la remontait
à la main au dernier tour, a disparu.

En **double élimination**, il produit l'ordre réel de déroulement. Sur un
plateau à quatre :

```
UB1a, UB1b   →   UB2, LB1   →   LB2   →   grande finale
   index 0        index 1      index 2      index 3
```

Chaque stade ne contient que des rencontres qui **ne dépendent pas les unes des
autres** : le premier tour de repêchage se joue en même temps que la seconde
manche du tableau principal, et ni l'un ni l'autre n'attend le résultat de son
voisin. La profondeur est le **plus long** chemin et non le plus court, parce
qu'un match mène à la grande finale par deux routes de longueurs différentes (le
vainqueur du tableau principal y va en un pas, son perdant repasse par tout le
repêchage) ; le plus court rangerait la finale du tableau principal avant des
rencontres qui la précèdent.

En **multi-phases**, le rang de phase passe avant tout : un match de la phase 2
suit toujours un match de la phase 1, quels que soient leurs numéros de manche.

## Ce que « le dernier stade joué » veut dire

Le stade **maximal parmi les matchs portant une saisie** — `hasScoreInput` : un
score même nul, un vainqueur, un forfait de match, un report en attente de
confirmation.

Pas le dernier stade *existant*. En élimination, tout le plateau est créé au
lancement : la finale existe donc dès la première rencontre, et viser le dernier
stade créé ne défairait jamais rien.

Les **byes** et les matchs fantômes n'entrent pas dans le compte : leur 1-0 est
posé par le moteur, personne ne l'a saisi (même exclusion que `match-lock`). Ils
sont en revanche vidés avec leur stade, et `tryAutoResolveByes` les repose.

**Conséquence utile** : tout ce qui suit le stade visé est nécessairement
vierge. Le retour en arrière n'efface jamais un résultat qu'il n'a pas montré.

## Ce que le retour en arrière écrit

| Ce qui est touché | Écriture |
| --- | --- |
| Rencontres du stade | scores, vainqueur, perdant, forfait, reports en attente et délai effacés ; statut recalculé (`READY` si deux engagées, `PENDING` sinon) |
| Ce qui suit — **plateau** | qualifiées vidées, statut `PENDING`, antenne refermée |
| Ce qui suit — **format à classement** | manches supprimées (matchs, rappels, réservations d'alerte) |
| Ce qui suit — **phase ultérieure** | supprimé de la même façon, quel que soit son format |

**Les identifiants de match survivent** partout où c'est possible. Le stade est
*vidé*, pas supprimé : un identifiant de match est une adresse publique — lien
profond (`lib/shared/match-anchor.ts`), horaire annoncé, diffusion programmée —
et la rencontre va se rejouer entre les mêmes équipes. Seul ce que le moteur
sait **reposer** est supprimé : les manches à venir d'un format à classement
(leurs appariements viennent d'un classement qu'on vient de défaire) et le
plateau d'une phase ultérieure (posé avec des qualifiées qu'on vient d'annuler).

**Ce qui n'est pas touché** : les abandons (`forfeit`), les pénalités
d'endurance, les inscriptions, le seeding. Ce sont des *entrées* du rejeu au même
titre que les matchs, et ils restent en vigueur — les défaire serait une autre
décision, prise par un autre geste.

## Le moteur n'a presque rien à apprendre

Aucun mode n'a de branche « retour en arrière ». Les trois formats à classement
**rejouent** tout depuis l'historique des matchs (`replaySwiss`,
`replaySurvival`, `replayEndurance`) : un stade effacé disparaît du rejeu comme
s'il n'avait jamais été joué. Il suffit donc d'effacer les saisies puis
d'appeler la réconciliation ordinaire — exactement la chaîne d'une correction de
score (`tryAutoResolveByes`, `reconcileSurvival`, `reconcileSwiss`,
`reconcileEndurance`, `reconcilePhases`).

*Presque* : **quatre états ne se déduisent pas des matchs**, et le module serveur
est seul à devoir les reculer.

### 1. Le curseur de manche

`swiss_current_round`, `survival_current_round` et `endurance_current_round` ne
sont **pas** dérivés des matchs : le moteur pose la manche « curseur + 1 » puis
incrémente. Cela s'est vu en conditions réelles — défaire la manche 1 d'une ronde
suisse à huit y créait une « ronde 3 » pendant que la 1 restait vierge.

Le curseur est donc ramené sur la manche défaite. Il vit sur `bg_tournaments`
pour un tournoi à format unique et sur `bg_tournament_phases` pour une phase :
c'est le rang de phase du stade qui dit lequel. Un plateau n'en a pas (il naît
entier), et un tour d'arbre de BG Survie n'y touche pas non plus — l'arbre vit à
partir de `PLAYOFF_ROUND_OFFSET`, le curseur ne compte que les qualifications.

### 2. `endurance_playoffs_started`

C'est le seul état que `reconcileEndurance` consulte pour savoir s'il doit relire
un arbre ou apparier une manche. Il est **relu sur ce qui reste** : s'il ne
subsiste aucun match au-delà de `PLAYOFF_ROUND_OFFSET`, il retombe.

### 3. L'état des phases

C'est le seul endroit du projet qui fasse **reculer** un tournoi multi-phases :
`reconcilePhases` ne sait qu'avancer — il relit un classement, clôt une phase, en
lance une autre, jamais l'inverse.

La phase visée redevient `RUNNING` (`finished_at` effacé, `current_phase_id`
ramené sur elle) et perd les rangs et qualifications de ses équipes : ils seront
réécrits à sa prochaine clôture, et les laisser afficherait des qualifiées que
plus rien ne désigne.

Une phase ultérieure retourne à `PENDING` avec ses compteurs — et surtout **son
plateau d'engagées est effacé** : `insertPhaseTeams` est un upsert, une ancienne
liste de qualifiées survivrait à la nouvelle et la phase repartirait avec des
équipes que plus rien ne qualifie. Les classements que ses moteurs tiennent
(`bg_swiss_standings`, `bg_survival_standings`) partent pour la même raison :
leurs initialisations sont des upserts, elles ne suppriment pas une ligne
devenue orpheline.

### 4. L'état du tournoi

Un tournoi **terminé** se défait, et c'est le cas qui manquait le plus : l'erreur
de finale était la seule que `match-lock` ne laissait plus corriger. Corriger
*un* score d'archive se rejoue déjà et réécrit un palmarès
(`FINISHED_TOURNAMENT_RECONCILIATION.md`) ; effacer la finale entière demande une
chose de plus — rouvrir —, parce qu'une clôture, elle, ne se rejoue pas.

L'état repasse à `RUNNING`, `finished_at` est effacé et `final_rank` avec (il
désignait une championne que plus aucun match ne désigne). `finishTournament`
étant écrit pour ne clore qu'une fois (`state <> 'FINISHED'`), le tournoi sera
reclos — avec sa ligne de journal et sa nouvelle championne — dès que le stade
rouvert aura été rejoué. La réouverture est écrite **avant** l'effacement : la
réconciliation qui suit lit l'état du tournoi pour décider ce qu'elle a le droit
de reposer, et un tournoi resté « terminé » se contenterait d'y réécrire un
palmarès.

## Le cas en deux temps de la BlueGenji Survie

Défaire l'arbre final ne se fait pas d'un pas, et ce n'est pas un oubli.

1. **Premier clic** — le dernier tour posé porte des scores : il est vidé, les
   tours qui en descendaient sont supprimés. L'arbre reste debout, le drapeau
   reste levé. On peut recommencer, tour par tour, jusqu'au premier.
2. **Second clic**, une fois le premier tour de l'arbre vierge — le stade visé
   devient la **dernière manche qualificative**. Tout l'arbre passe alors en
   « ce qui suit », est supprimé, et le drapeau retombe.

Ce découpage est ce qui rend le geste stable. Un pas unique qui viderait l'arbre
*et* rendrait la main à la qualification laisserait le tournoi dans un état que
le moteur traverse sans s'y arrêter : la qualification étant toujours achevée,
`reconcileEndurance` retirerait l'arbre dans la foulée. En deux temps, chaque
arrêt est un état où le tournoi sait quoi attendre.

## Les refus, et pourquoi

| Code | Sens |
| --- | --- |
| `ROLLBACK_NOTHING_TO_UNDO` | plus aucun score saisi : le tournoi est revenu à son coup d'envoi |
| `ROLLBACK_TOURNAMENT_NOT_STARTED` | le tournoi n'a pas encore commencé |
| `ROLLBACK_ROUND_CHANGED` | le stade courant a bougé entre l'écran et le clic |

Il y en avait trois de plus, et leur disparition est tout l'objet de cette
version : **double élimination** (le graphe ordonne les deux tableaux),
**multi-phases** (le rang de phase les ordonne, et les phases se rouvrent), **BG
Survie arbre tiré** (il se défait tour par tour, puis d'un pas de plus). Le refus
sur tournoi terminé a disparu aussi — c'est devenu une réouverture.

**Le stade a bougé.** Le plan est recalculé côté serveur, sur une lecture
verrouillée : il peut donc désigner un **autre** stade que celui affiché si un
second arbitre a saisi un score entre l'ouverture du dialogue et le clic. Or le
dialogue *montre* les rencontres qu'il efface, et c'est là toute la sauvegarde de
l'arbitre. Il envoie donc la **clé** du stade qu'il a promis d'effacer
(`expectedStage`, de la forme `"<rang de phase>:<index>"`), et le serveur refuse
plutôt que d'effacer des scores que personne n'a vus. Le garde-fou ne peut que
faire **refuser** le geste, jamais le déplacer : un corps absent ou illisible
retombe sur ce que la base désigne.

## Droits

`can(user, "tournaments")` — administrateur **ou arbitre**. Défaire un stade est
un acte d'arbitrage, la version en gros de la correction de score que l'arbitre
fait déjà tous les soirs de tournoi. La suppression définitive reste le seul
geste du domaine à exiger `isAdmin`, parce qu'elle, rien ne la rejoue.

La zone de danger de `/tournois/[id]` s'ouvre donc à deux publics, chaque bloc
gardant sa propre garde : le retour en arrière sur `isAdmin` (qui vaut la
permission `tournaments`), la suppression sur `canDelete`.

## L'interface

Le bouton vit dans la **zone de danger**, au-dessus de la suppression — c'est le
geste qu'un arbitre vient chercher là, et le seul des deux qui se rejoue. Il est
rendu **même quand il est refusé**, désarmé, avec son motif en toutes lettres : un
bouton qui disparaît laisse chercher, une phrase explique.

Le plan est calculé côté client par le module que le serveur applique lui-même :
le bouton ne s'arme donc jamais sur un stade que la route refuserait, et le motif
affiché est exactement celui qu'elle rendrait.

Le bouton refusé est `aria-disabled`, non `disabled` : un bouton désactivé n'est
pas focalisable, si bien qu'un lecteur d'écran sautait le contrôle **et** le
motif qui lui est rattaché. Il reste inerte par la garde du gestionnaire de clic,
et `CyberButton` habille les deux attributs de la même façon.

Le dialogue de confirmation ne se contente pas d'avertir, il **montre ce qui va
disparaître** : chaque rencontre du stade y figure avec son score. C'est la
seule sauvegarde possible avant le geste — rien n'est archivé, et un
avertissement « pense à noter les scores » sans les scores sous les yeux
enverrait l'arbitre les chercher dans un plateau qu'il s'apprête à vider. Une
case à cocher (« J'ai noté les scores ci-dessus ») arme le bouton, pour la même
raison que la recopie du nom sur la suppression.

Sur un tournoi **terminé**, un second encart annonce la réouverture avant le clic
— c'est la seule conséquence du geste qui déborde du plateau, et elle mérite
d'être dite : le palmarès publié disparaît, et une nouvelle championne sera
réannoncée sur Discord.

Après le geste, le flux pousse le nouveau plateau et le bouton se réarme **sur le
stade précédent** : reculer de trois manches, c'est trois fois le même geste,
chacun montrant ce qu'il efface.

## Une manche est féminine, un tour ne l'est pas

`rollbackStageLabel` rend « manche 4 », « tour 2 des play-offs » (les tours de
l'arbre final sont numérotés à partir de `PLAYOFF_ROUND_OFFSET` : les afficher
tels quels annoncerait « manche 1002 »), ou « manche 3 de la phase 2 ».

Sur un **plateau**, le numéro annoncé est le rang du stade et non le numéro de
manche stocké : en élimination simple les deux coïncident, en double ils ne le
peuvent pas — « manche 2 » y désignerait deux stades sans rapport.

`rollbackStageLabelWithArticle` y ajoute l'article, et il en faut deux — le
français l'impose. Toute phrase qui accorde quoi que ce soit avec le libellé se
trompe une fois sur deux si elle fabrique l'article elle-même. Les textes sont
donc tournés pour n'avoir jamais besoin d'une troisième forme : « de la manche 4 »
et « du tour 2 » ne se dérivent pas l'un de l'autre.

## Journal Discord

Une ligne au canal de logs, jamais au canal arbitre : c'est le staff qui vient de
faire le geste, il n'y a rien à lui demander. Mais elle *doit* y figurer — c'est
la seule action du site qui efface des résultats déjà annoncés, et une équipe qui
retrouve sa manche vierge doit pouvoir lire pourquoi, et par qui.

Envoyée depuis la route, après le commit, au meilleur effort (même précédent que
la suppression d'un tournoi) :

```
⏪ Retour en arrière — « BlueGenji Open » (#7) : la manche 4 — 3 rencontres effacées, par Sifflet (#2).
⏪ Retour en arrière — « BlueGenji Open » (#7) : la manche 5 — 1 rencontre effacée, tournoi rouvert, par Sifflet (#2).
```

Le libellé vient du **serveur** et jamais de l'écran : celui-ci pouvait viser un
stade périmé, et une ligne qui nomme la mauvaise manche serait pire qu'aucune
ligne.

## Tests

| Fichier | Couvre |
| --- | --- |
| `tests/lib/shared/tournament-rollback.test.ts` | choix du stade, graphe de plateau (simple, double, petite finale), formats à classement, arbre d'endurance en deux temps, phases, byes, clés et libellés |
| `tests/lib/server/tournament-rollback-service.test.ts` | écritures, verrou, gardes d'état, curseurs (tournoi et phase), drapeau d'arbre, réouverture des phases et du tournoi, chaîne de réconciliation |
| `tests/app/api/admin/tournament-rollback.test.ts` | droits, codes HTTP, garde-fou `expectedStage`, ligne de journal |
