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
les autres. Les têtes de série viennent des inscrites (`buildSeedMap`),
diffusées par `EntrantProvider` (`useEntrantSeeds`).

## Horloge

Seul le temps fait passer « En attente de lancement » → « Lancement ». Le
composant `RoundMatchSections` lit `useClock(15 s)` — régime de charge
respecté (`CLIENT_POWER_MODES.md`) — et **seulement** si un match de la manche
est daté et pas encore lancé. Avant le montage (`now` nul), un match daté est
tenu « en attente » : l'heure du lecteur n'est pas encore connue.

## Filet

Libellé en capitales 11 px (`--ink-mute`), nombre de matchs (`--ink-dim`),
trait `--line-soft`. Chaque section est un `role="group"` nommé par son
libellé (« Lancement, 2 matchs ») : aucun élément focalisable ajouté. Le
libellé passe à la ligne dans une colonne étroite (210 px).

## Code

- `lib/shared/match-sections.ts` — `matchSectionOf`, `compareSectionMatches`,
  `sectionRoundMatches`, `needsSectionClock`, `buildSeedMap`.
- `app/(secured)/tournois/[id]/_components/RoundMatchSections.tsx` (+ `.module.css`).
- Tests : `tests/lib/shared/match-sections.test.ts`,
  `tests/tournois/round-match-sections-render.test.tsx`.
