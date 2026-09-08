# Retour en arrière — défaire la manche courante

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

D'où une action unique, dans la zone de danger de la fiche : **effacer la manche
courante d'un coup**. Le tournoi revient à l'instant qui précède son coup
d'envoi, et la manche d'avant redevient corrigible.

## Ce que « la manche courante » veut dire

La dernière manche **portant une saisie** — `hasScoreInput` : un score même nul,
un vainqueur, un forfait de match, un report en attente de confirmation.

Pas la dernière manche *existante*. En élimination, tout le plateau est créé au
lancement : la finale existe donc dès la première rencontre, et viser la
dernière manche créée ne défairait jamais rien. La dernière manche *jouée* est la
seule lecture qui donne la même réponse aux deux familles de formats.

Les **byes** et les matchs fantômes n'entrent pas dans le compte : leur 1-0 est
posé par le moteur, personne ne l'a saisi (même exclusion que `match-lock`).

### La petite finale

Elle se joue au stade de la finale, mais l'élimination simple la crée en
**manche 1** (`bracket-single.ts` : elle n'a pas de tour amont à numéroter). La
ranger sur son numéro effacerait la troisième place en défaisant le premier tour
d'un tournoi à seize équipes, et laisserait la petite finale debout en défaisant
la finale.

`matchStage` la range donc au stade le plus élevé du plateau. La BlueGenji Survie
le fait déjà d'elle-même — sa petite finale porte le numéro de la finale — et le
`Math.max` y rend simplement la même valeur.

## Ce que le retour en arrière écrit

| Ce qui est touché | Écriture |
| --- | --- |
| Rencontres de la manche | scores, vainqueur, perdant, forfait, reports en attente et délai effacés ; statut recalculé (`READY` si deux engagées, `PENDING` sinon) |
| Ce qui en descendait — **élimination** | qualifiées vidées, statut `PENDING`, antenne refermée |
| Ce qui en descendait — **formats à classement** | manches supprimées (matchs, rappels, réservations d'alerte) |

**Les identifiants de match survivent.** La manche est *vidée*, pas supprimée :
un identifiant de match est une adresse publique — lien profond
(`lib/shared/match-anchor.ts`), horaire annoncé, diffusion programmée — et la
manche va se rejouer entre les mêmes équipes. Seules les manches **ultérieures**
des formats à classement sont supprimées : le moteur les pose au fur et à mesure,
leurs appariements sont périmés par le retour en arrière, et il les reposera.

**Ce qui n'est pas touché** : les abandons (`forfeit`), les pénalités
d'endurance, les inscriptions, le seeding. Ce sont des *entrées* du rejeu au même
titre que les matchs, et ils restent en vigueur — les défaire serait une autre
décision, prise par un autre geste.

## Le moteur n'a rien à apprendre

Aucun mode n'a de branche « retour en arrière ». Les trois formats à classement
**rejouent** tout depuis l'historique des matchs (`replaySwiss`,
`replaySurvival`, `replayEndurance`) : une manche effacée disparaît du rejeu
comme si elle n'avait jamais été jouée. Il suffit donc d'effacer les saisies puis
d'appeler la réconciliation ordinaire — exactement la chaîne d'une correction de
score (`tryAutoResolveByes`, `reconcileSurvival`, `reconcileSwiss`,
`reconcileEndurance`). Un format ajouté demain en hérite pour peu qu'il rejoue
son classement.

## Les refus, et pourquoi

| Code | Sens |
| --- | --- |
| `TOURNAMENT_NOT_RUNNING` | le tournoi n'est pas (ou plus) en cours |
| `ROLLBACK_UNSUPPORTED_FORMAT` | double élimination, multi-phases |
| `ROLLBACK_NOTHING_TO_UNDO` | aucun score saisi sur le plateau |
| `ROLLBACK_PLAYOFFS_STARTED` | BG Survie : l'arbre est tiré, les manches qualificatives ne se défont plus |

**Tournoi terminé.** Corriger *un* score d'archive se rejoue et réécrit le
palmarès (`FINISHED_TOURNAMENT_RECONCILIATION.md`) ; effacer la finale entière
laisserait un tournoi « terminé » sans championne et sans manche pour en désigner
une — la clôture, elle, ne se rejoue pas. Refusé, comme l'abandon et la pénalité.

**Double élimination.** Les manches du winner et du loser bracket avancent en
parallèle et se numérotent chacune de leur côté. « Manche 3 » n'y désigne pas un
stade du tournoi mais deux stades sans rapport : les effacer ensemble reculerait
d'un cran ici et de trois là.

**Multi-phases.** Une manche appartient à une phase, dont la clôture a déjà remis
ses qualifiées à la suivante. Défaire la dernière manche d'une phase close
supposerait de *rouvrir* la phase et de défaire le plateau de la suivante — ce
que `reconcilePhases` ne sait pas faire : il relit un classement, il ne revient
jamais en arrière sur une phase démarrée.

**BG Survie, arbre tiré.** Défaire une manche *qualificative* rendrait à la
course des équipes que l'arbre a été tiré sans elles. Les tours de l'arbre, eux,
se défont normalement — `repairPlayoffBracket` les relit déjà.

## Droits

`can(user, "tournaments")` — administrateur **ou arbitre**. Défaire une manche
est un acte d'arbitrage, la version en gros de la correction de score que
l'arbitre fait déjà tous les soirs de tournoi. La suppression définitive reste le
seul geste du domaine à exiger `isAdmin`, parce qu'elle, rien ne la rejoue.

La zone de danger de `/tournois/[id]` s'ouvre donc à deux publics, chaque bloc
gardant sa propre garde : le retour en arrière sur `isAdmin` (qui vaut la
permission `tournaments`), la suppression sur `canDelete`.

## L'interface

Le bouton vit dans la **zone de danger**, au-dessus de la suppression — c'est le
geste qu'un arbitre vient chercher là, et le seul des deux qui se rejoue. Il est
rendu **même quand il est refusé**, désarmé, avec son motif en toutes lettres : un
bouton qui disparaît laisse chercher, une phrase explique.

Le plan est calculé côté client par le module que le serveur applique lui-même :
le bouton ne s'arme donc jamais sur une manche que la route refuserait, et le
motif affiché est exactement celui qu'elle rendrait.

Le dialogue de confirmation ne se contente pas d'avertir, il **montre ce qui va
disparaître** : chaque rencontre de la manche y figure avec son score. C'est la
seule sauvegarde possible avant le geste — rien n'est archivé, et un
avertissement « pense à noter les scores » sans les scores sous les yeux
enverrait l'arbitre les chercher dans un plateau qu'il s'apprête à vider. Une
case à cocher (« J'ai noté les scores ci-dessus ») arme le bouton, pour la même
raison que la recopie du nom sur la suppression.

## Une manche est féminine, un tour ne l'est pas

`rollbackRoundLabel` rend « manche 4 » ou « tour 2 des play-offs » (les tours de
l'arbre final sont numérotés à partir de `PLAYOFF_ROUND_OFFSET` : les afficher
tels quels annoncerait « manche 1002 »).

`rollbackRoundLabelWithArticle` y ajoute l'article, et il en faut deux — le
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
```

## Tests

| Fichier | Couvre |
| --- | --- |
| `tests/lib/shared/tournament-rollback.test.ts` | choix de la manche, petite finale, byes, refus, libellés |
| `tests/lib/server/tournament-rollback-service.test.ts` | écritures, verrou, gardes d'état, chaîne de réconciliation |
| `tests/app/api/admin/tournament-rollback.test.ts` | droits, codes HTTP, ligne de journal |
