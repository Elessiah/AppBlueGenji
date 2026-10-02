# Multi-phases — qualification d'une élimination simple tronquée

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Constat

Une phase `SINGLE` **intermédiaire** d'un tournoi `MULTI` joue un tableau tronqué à `maxRounds` manches (`docs/features/MULTI_PHASE_TOURNAMENTS.md` § 4) : la dernière manche jouée compte autant de rencontres que de qualifiées. La documentation dit que « les équipes encore en lice à l'issue de ces manches sont les qualifiées ».

`rankEliminationPhase` (`lib/server/tournaments/finalization.ts`) lit pourtant le « podium » d'une élimination simple dans **une seule** rencontre : `bracket = 'UPPER' ORDER BY round_number DESC LIMIT 1`. Dans un tableau tronqué, toutes les rencontres de la dernière manche sont au même tour : la base en rend une, sans ordre fixé. Sa gagnante est rangée 1ʳᵉ, sa **perdante 2ᵉ**, puis le reste par bilan.

`rankPhaseStandings` (`lib/server/tournaments/phases.ts`) qualifie ensuite **par index** (`index < qualifiers`). Avec une cible de 2 et deux rencontres au dernier tour, les qualifiées sont la gagnante et la perdante de la rencontre relevée ; la gagnante de l'autre rencontre (3ᵉ) est éliminée. Avec une cible de 4 sur quatre rencontres, une gagnante sur quatre est écartée au profit d'une perdante.

Quand un double forfait laisse moins de gagnantes que la cible, l'index qualifie aussi une perdante du tableau (bilan 0 V – 1 D, sans double forfait), qui n'est plus « en lice ».

Constaté en lisant le code et en écrivant `tests/tournois/multi-phase-participants.test.ts` (les scénarios de ce fichier posent l'exemption en tête de liste pour ne pas dépendre de ce défaut). Non reproduit sur une base réelle.

## À confirmer

- Le générateur (`bracket-single.ts`, `maxRounds`) produit-il bien plusieurs rencontres au dernier tour d'une phase tronquée, sans rencontre d'un tour supérieur ?
- Quel ordre MariaDB rend-il en pratique pour ce `LIMIT 1` (souvent l'ordre d'insertion) ?

## Piste

Pour une phase `SINGLE` dont `max_rounds` tronque le tableau, ne pas lire de podium : qualifier les équipes **gagnantes de la dernière manche jouée** (exemptions comprises, doubles forfaits exclus), puis ranger tout le tableau par `orderEliminationRest`. Garder le podium pour la phase finale (non tronquée). Ajouter un test de phase tronquée à deux puis quatre rencontres au dernier tour.
