# Corriger le score d'un tournoi terminé

Un arbitre peut corriger le résultat d'une manche **après** la fin du tournoi :
`adminResolveMatch` n'a aucune garde d'état, et c'est un choix — une archive
fausse se répare. `finishTournament` est d'ailleurs écrit pour ce cas, sa clause
`state <> 'FINISHED'` faisant de la clôture une opération à effet unique (pas de
seconde date de clôture, pas de seconde annonce Discord de la championne).

- Endurance : `reconcileEndurance` (`lib/server/tournaments/bg-survie.ts`)
- Survie : `reconcileSurvival` (`lib/server/tournaments/survival.ts`)
- Ronde suisse : `reconcileSwiss` (`lib/server/tournaments/swiss.ts`)
- Multi-phases : `reconcilePhases` (`lib/server/tournaments/phases.ts`)

## Le symptôme

Les trois modes à classement sortaient **en tête** de leur réconciliation sur un
tournoi `FINISHED` :

```ts
if (tournament.state === "FINISHED") return;
```

Corriger le vainqueur de la finale changeait donc bien `winner_team_id` en base,
mais ni le podium ni `final_rank` n'étaient recalculés : le tournoi gardait
**l'ancienne championne à son palmarès**. Pire, la contradiction était visible :
la page rejoue toujours le classement (`loadEnduranceMeta` et ses équivalents),
elle affichait donc le nouveau vainqueur à côté d'un palmarès stocké qui
désignait l'autre.

Les formats à élimination n'ont jamais eu ce défaut —
`finalizeTournamentIfDone` ne regarde pas l'état et refait son classement.

## La règle

> Le classement se rejoue, le tournoi ne se rouvre pas.

Sur un tournoi terminé, chaque réconciliation :

1. **rejoue** l'historique et persiste le classement, comme d'habitude ;
2. **refinalise** — podium, `final_rank`, `finishTournament` (sans effet sur
   l'état, déjà `FINISHED`) ;
3. ne **pose rien** : ni manche, ni ronde, ni tour d'arbre, ni bascule en
   play-offs.

Le troisième point est la moitié qui compte. Sans lui, une correction pouvait
faire remonter l'effectif actif au-dessus de la cible et reposer une manche à un
tournoi clos — que plus rien n'aurait fait avancer, l'entretien passif de
`syncTournamentState` ne visitant que les tournois `RUNNING`. Un tournoi terminé
se serait retrouvé avec des rencontres ouvertes à jamais.

En endurance, la branche play-offs n'a pas besoin de cette précaution et passe
donc par le chemin ordinaire : `repairPlayoffBracket` ne réécrit **jamais** un
tour portant une saisie, et dans un tournoi clos ils en portent tous.

## Ce qui est corrigible, en pratique

Presque rien — et c'est ce qui rend la règle sûre. `match-lock` interdit de
modifier un score dès que la manche suivante porte la moindre saisie, **y
compris à un administrateur** (`CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES`,
409). Dans un tournoi terminé, seules la **finale** — et la petite finale —
restent donc éditables : tout ce qui est en amont est verrouillé par ce qui suit.

La correction ne peut donc pas réécrire l'histoire du tournoi, seulement son
dernier résultat. C'est exactement le cas que l'ancienne sortie en tête laissait
sans effet.

## Ce qui reste refusé

- **Les abandons** (`forfeitSurvivalTeam`, `forfeitSwissTeam`) exigent
  `RUNNING` : ils ne réparent rien, ils changent le déroulé.
- **Les pénalités d'endurance** de même — voir `ENDURANCE_PENALTIES.md`.
  Corriger le score d'une archive répare une erreur d'arbitrage ; la sanctionner
  après coup en crée une.

## Le cas `MULTI`, à deux gardes

Le mode multi-phases portait le même défaut, mais il ne se levait pas d'une
seule main : `reconcilePhases` sort **deux fois**, sur l'état du tournoi puis
sur celui de la phase courante.

```ts
if (rows[0].state !== "RUNNING") return;          // le tournoi
if (currentPhase.state !== "RUNNING") return;     // la phase
```

Or la phase finale d'un tournoi clos est close elle aussi — c'est
`reconcilePhases` lui-même qui l'a fermée juste avant d'appeler
`finalizeMultiTournament`. Ne lever que la première garde n'aurait donc rien
changé.

Les deux acceptent désormais l'état terminal, et **seulement lui** : sur un
tournoi `FINISHED`, la phase courante doit être `FINISHED`. Un tournoi clos dont
la phase courante serait encore `RUNNING` est une incohérence — on ne la répare
pas ici, on ne la relit pas.

La suite est celle des autres modes, à un détail près : c'est le **moteur de la
phase** qui rend le classement (survie, ronde suisse ou bracket, exactement les
trois branches du chemin ordinaire), on le réécrit avec `savePhaseResults`, puis
on rejoue `finalizeMultiTournament` — et on s'arrête là. Ce qui est **sauté**
sur un tournoi clos :

- `setPhaseState(..., "FINISHED", "finished_at")`, qui redaterait la clôture
  d'une phase déjà close ;
- la re-résolution du plan des phases restantes, qui n'a plus d'objet ;
- le démarrage de la phase suivante et la récursion qui l'accompagne — c'est le
  « le tournoi ne se rouvre pas » du mode.

Relire la seule phase courante suffit, et pour la même raison qu'ailleurs :
`match-lock` verrouille toute phase qu'une phase ultérieure suit, et à
l'intérieur de la dernière, la règle du format verrouille les manches amont. La
dernière manche de la dernière phase est la seule chose qui reste corrigible —
c'est précisément celle que l'on rejoue.
