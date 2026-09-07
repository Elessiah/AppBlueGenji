# Pénalités d'endurance (mode « BlueGenji Survie »)

L'arbitrage peut retirer des points d'endurance à un engagé : retard au coup
d'envoi, joueur non éligible aligné, conduite antisportive. La sanction pèse sur
le classement **sans passer par un score de match** — aucune manche ne s'est mal
jouée, c'est le capital qui est amputé.

Réservé au format `BG_SURVIE` : c'est le seul où un capital décide de quoi que
ce soit. Voir `docs/features/BG_SURVIE_MODE.md`.

| Où | Quoi |
| --- | --- |
| `lib/shared/endurance-penalty.ts` | Forme d'une sanction (bornes, motif, messages). Pur. |
| `lib/shared/bg-survie.ts` | Rejeu : `EndurancePenalty`, `applyPenalty`, marque de case. Pur. |
| `lib/server/tournaments/bg-survie.ts` | `applyEndurancePenalty`, `liftEndurancePenalty`, lecture. |
| `bg_endurance_penalties` | La table. Une ligne = une sanction. |
| `POST /api/tournaments/[id]/penalties` | Infliger. Permission `tournaments`. |
| `DELETE /api/tournaments/[id]/penalties/[penaltyId]` | Retirer. Permission `tournaments`. |

## Une entrée du rejeu, jamais un résultat

Le classement d'endurance est **rejoué** à chaque entretien (`replayEndurance`)
puis réécrit : un cumul de pénalités qui vivrait dans `bg_endurance_standings`
serait effacé au premier score corrigé. La pénalité est donc rangée là où
vivent déjà les autres **décisions humaines** — comme l'abandon : une entrée du
rejeu, dans sa propre table.

Trois conséquences, gratuites :

- **Retirer une pénalité défait tout ce qu'elle avait entraîné** — les points,
  l'élimination qu'elle avait provoquée, la coupe sous plafond qui en découlait,
  l'appariement de la manche suivante tant qu'elle n'est pas entamée. Exactement
  comme une correction de score défait la coupe qu'elle avait causée.
- **Une pénalité n'ajoute jamais.** Un « bonus » d'endurance n'existe pas au
  règlement, et corriger une sanction par une seconde de sens inverse laisserait
  au classement deux lignes dont l'une est un pansement. On retire la ligne.
- **Rien n'est à recalculer ailleurs.** Le tableau manche par manche, le
  classement, les appariements et la bascule en play-offs descendent tous du
  même rejeu.

## La chronologie tient à la manche

Chaque ligne porte la **manche courante** au moment où elle est prononcée
(`round_number`), et le rejeu l'applique **après les matchs de cette manche,
avant les abandons** :

1. les matchs de la manche ;
2. les pénalités de la manche ;
3. les abandons de la manche ;
4. la coupe de fin de manche (sous plafond) ;
5. le gel de l'ordre, qui servira de départage à la suivante.

L'ordre n'est pas indifférent. Une sanction qui vide le capital **élimine** —
c'est la règle du mode, « élimination immédiate à 0 », et lui ménager une
exception laisserait au plateau une équipe à zéro point que plus aucune manche
ne pourrait départager. Mais un abandon déclaré la même manche reste ce qui
s'écrit au classement : la bascule `eliminatedThisRound` de `replayEndurance`
s'en charge, sans une ligne de plus.

Avant la première manche (`endurance_current_round = 0`), la sanction porte tout
de même sur la manche 1 : le rejeu ne connaît pas de manche 0, et une pénalité
prononcée au coup d'envoi doit peser dès le premier appariement.

## La fenêtre : la phase qualificative, et rien d'autre

Infliger **et** retirer sont refusés une fois les play-offs lancés
(`ENDURANCE_PLAYOFFS_STARTED`, 400), pour deux raisons distinctes :

- **Infliger** n'aurait aucun effet — le capital ne décide plus rien une fois
  l'arbre tiré — mais la sanction figurerait au tableau comme si elle en avait
  un.
- **Retirer** en aurait un, et c'est pire : le rejeu rendrait ses points à
  l'équipe et pourrait la ramener « en lice » alors que le plateau est déjà tiré
  sans elle — un classement qui contredit l'arbre affiché juste au-dessus.

Une sanction devient donc définitive au moment précis où le capital cesse de
compter. Même règle que l'abandon, et le même code d'erreur.

Refusé aussi sur un engagé qui n'est plus en lice (`TEAM_ALREADY_OUT`) : il n'y
a rien à lui retirer. Le rejeu tient la même règle de son côté (`applyPenalty`
ne touche pas à une équipe sortie) — le cas est atteignable après coup, une
correction de score pouvant faire tomber une équipe *avant* la manche où elle
avait été sanctionnée.

## La forme d'une sanction

`checkEndurancePenalty(points, reason)` — appliqué par le formulaire **et** par
la route, sans réécriture :

| Refus | Règle |
| --- | --- |
| `POINTS_NOT_POSITIVE` | Un entier, au moins 1. Une demi-pénalité n'a pas de sens au classement. |
| `POINTS_TOO_HIGH` | Au plus 99. Le plafond ne dit pas ce qui est juste, il arrête la faute de frappe. |
| `REASON_REQUIRED` | Motif obligatoire. |
| `REASON_TOO_LONG` | Au plus 200 caractères, après normalisation des espaces. |

Le **motif est obligatoire** parce que la sanction est publique, qu'elle change
un classement et qu'elle sera contestée : « −3 » sans un mot n'est ni défendable
par l'arbitre ni compréhensible par l'équipe. Pour la même raison, la ligne
porte le pseudo de qui l'a prononcée — et le garde en `NULL` si ce compte est
supprimé plus tard : le compte s'efface, la sanction reste due.

## Ce que le lecteur voit

- **Classement** — un `−N` ambre à côté du capital, cumul des pénalités
  **effectivement retirées**. Une sanction visant une équipe déjà sortie n'a
  rien amputé : l'annoncer ferait mentir la colonne.
- **Journal des sanctions** — sous le classement, visible de **tous** : montant,
  engagé, motif, manche, arbitre. Une sanction qui déplace un classement sans
  qu'aucun match ne l'explique doit être lisible par l'équipe qui la subit comme
  par celles qu'elle fait remonter. Seul le bouton « Retirer » est réservé à
  l'arbitrage.
- **Tableau manche par manche** — la case de la manche sanctionnée reçoit un
  **soulignement ambre**, et garde son ton d'origine. La case dit un capital ;
  la pénalité explique seulement pourquoi il a bougé sans qu'un score ne
  l'explique — elle ne doit ni concurrencer le chiffre ni prendre la place du
  rouge des forfaits, qui a un autre sens.
- **Dialogue** — annonce le capital restant, et **nomme l'élimination** quand la
  sanction ramène à zéro : c'est la conséquence qui peut surprendre, elle se lit
  avant le clic et non dans le classement après coup.

## Journal Discord

Deux évènements, tous deux au **journal** et non au canal arbitre
(`lib/shared/referee-alerts.ts`) : c'est l'arbitre lui-même qui vient de les
prononcer, il n'a rien à faire de plus en les lisant. Ils y figurent quand même
parce qu'ils sont la seule façon, depuis Discord, de comprendre pourquoi une
équipe a perdu trois points sans jouer.

- `endurance_penalty` — « ⛔ Pénalité — … : Ravens perd 3 points d'endurance — retard au coup d'envoi. »
- `endurance_penalty_lifted` — « ↩️ Pénalité annulée — … : Ravens récupère 3 points d'endurance. »

Ce sont les **deux seules entrées de la file qui portent leur substance** plutôt
qu'un renvoi vers une ligne de la base : le montant et le motif *sont* l'action,
pas un état à relire, et la ligne d'une pénalité retirée n'existe plus au moment
de la résolution, qui suit le commit. L'engagé, lui, reste un renvoi — c'est son
nom d'aujourd'hui qu'il faut écrire.

## Suppression d'un tournoi

`bg_endurance_penalties` porte un `tournament_id` : elle fait partie de la liste
relisible de ce qui part dans `purgeTournamentRows`
(`docs/features/TOURNAMENT_DELETION.md`), sous `try` comme les alertes arbitre —
sa création est avalée par un `catch` dans `database.ts`, et une base à qui la
table manquerait rendrait sinon tous les tournois indéboulonnables.
