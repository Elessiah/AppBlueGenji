# Sections d'état des matchs d'une manche

## Objectif

Dans une manche, les cartes de match se suivaient dans l'ordre du plateau :
rien ne séparait ce qui reste à planifier de ce qui se joue ou de ce qui est
fini. Chaque liste de matchs **par manche** se découpe désormais en sections
d'état, chacune ouverte par un **filet discret titré** — jamais un volet
repliable.

Vues concernées :

- **BlueGenji Survie** — chaque volet de manche qualificative
  (`EnduranceRoundPanels`, voir `ENDURANCE_ROUND_PANELS.md`) ;
- **Survie** et **ronde suisse** — chaque colonne de manche (`RoundColumns`).

Hors périmètre : les **arbres** d'élimination (simple, double, play-offs de
BG Survie), dont l'ordre des cartes porte la structure de l'arbre.

## Sections et correspondance

Ordre fixe ; une section vide n'est pas affichée. La section se dérive de la
phase de lancement (`matchLaunchPhase`, `lib/shared/match-launch.ts`) — aucune
nouvelle notion d'état :

| Match | Section |
| --- | --- |
| phase `TO_PLAN` (planification par l'arbitrage, sans date) | À planifier |
| engagée inconnue (`PENDING`…), sans date | À planifier |
| phase `SCHEDULED` (date à venir) | En attente de lancement |
| engagée inconnue, datée (même heure passée : il ne peut pas se lancer) | En attente de lancement |
| phase `LOBBY` (heure atteinte, ou sans date hors planification) | Lancement |
| phase `LAUNCHED` (`launched_at` posé, ou `AWAITING_CONFIRMATION`) | En cours |
| `COMPLETED` (exemptions comprises) | Terminé |

« En attente de lancement » est le libellé de section de la phase que la carte
de match appelle « En attente de départ » (`LAUNCH_PHASE_LABELS`).

## Tri dans une section

1. date de début croissante — un match sans date passe en dernier ;
2. **meilleure tête de série** des deux engagées, la tête 1 d'abord (« seeding
   descendant » lu comme « du haut du seeding vers le bas ») ;
3. tête de série de l'autre engagée ;
4. identifiant du match (ordre stable).

Une engagée sans tête de série (inconnue, ou seed `null`) compte après toutes
les autres ; deux telles engagées se départagent par l'identifiant du match.
Les têtes de série viennent des inscrites de l'instantané (`buildSeedMap`),
diffusées par `EntrantProvider` (`useEntrantSeeds`). L'instantané y porte
toujours la **tête de série réelle** (`SEEDING_ORDER.md`) :

| Source du seeding | `registrations[].seed` |
| --- | --- |
| `MANUAL`, `REGISTRATION` | colonne `seed` (l'ordre qui a fait le tirage) |
| `RANKING`, avant le coup d'envoi | rang au classement du site (`rankEntrantsBySiteRanking`), renuméroté 1…N |
| `RANKING`, lancé | rang **figé au coup d'envoi** (`frozenSeedsOf`), `null` si absent |

Le rang figé est relu dans la table d'état écrite par le moteur au lancement
(`bg_swiss_standings` / `bg_survival_standings` `phase_id = 0`,
`bg_endurance_standings`, `bg_tournament_phase_teams` de la première phase
peuplée en multi-phases) : la cote du moment, qui bouge avec les matchs du
tournoi, n'est jamais relue — `frozenSeedsOf` la lit dans les classements que
l'instantané a déjà chargés, sans requête de plus. C'est la tête de série **du
tournoi** : les phases suivantes (suisse, survie) d'un multi-phases, tirées sur
le rang de la phase écoulée, trient leurs matchs par ce même rang de départ, pas
par leur propre tirage. La tête de série **affichée** est partout ce rang de
départ, arbre final de BG Survie compris — arbre dont les matchs, eux, ne sont
jamais triés (hors périmètre, voir plus haut). Aucun champ ajouté : le flux SSE et la lecture REST
de secours servent le même instantané (`buildSnapshot`).

## Horloge

Seul le temps fait passer « En attente de lancement » → « Lancement ».
`RoundMatchSections` arme **un seul minuteur** sur la prochaine heure de début
(`nextSectionChangeAt`, qui reprend `nextLaunchPhaseChangeAt`) — la règle de la
carte de match (`useMatchLaunchPhase`) : la carte et son filet basculent à la
même seconde. Aucun intervalle ; sans match daté en attente, aucun minuteur.
L'instant est lu dès le premier rendu (les matchs n'arrivent qu'au client) ;
un délai plafonné (~24,8 jours) relit l'heure réelle au réveil au lieu
d'avancer l'horloge.

## Filet

Libellé en capitales 11 px (`--ink-mute`), nombre de matchs (`--ink-dim`),
trait `--line-soft`. Le filet est un paragraphe lu comme une ligne de texte
(« Lancement, 2 matchs », le nombre complété pour les lecteurs d'écran) : ni
volet, ni repère, ni élément focalisable — et pas de `role="group"`, que le
contrôle Sonar S6819 interdit (`sonar-a11y-semantics.test.tsx`). Le
libellé passe à la ligne dans une colonne étroite (260 px).

Filets et cartes sont **frères** dans le seul conteneur de la vue (grille de
BG Survie, colonne de manche), chaque carte gardant pour clé l'id de son
match : un match qui change de section est **déplacé**, pas reconstruit. Le
bouton qui a ouvert une modale (score de l'arbitrage, report) existe donc
encore à sa fermeture, et le focus y revient (WCAG 2.4.3). Le filet prend
`width: 100%` pour occuper sa propre ligne dans la grille.

## Code

- `lib/shared/match-sections.ts` — `matchSectionOf`, `compareSectionMatches`,
  `sectionRoundMatches`, `nextSectionChangeAt`, `buildSeedMap`.
- `app/(secured)/tournois/[id]/_components/RoundMatchSections.tsx` (+ `.module.css`).
- Tests : `tests/lib/shared/match-sections.test.ts`,
  `tests/tournois/round-match-sections-render.test.tsx`.
