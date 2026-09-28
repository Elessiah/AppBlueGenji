# Réglages d'un tournoi sur la page des règles

Les pages `/regles/<mode>` décrivent un mode **en général** (« 9 points par défaut, réglable à la création »). Ouvertes depuis la fiche d'un tournoi, elles affichent en plus, en tête, **les valeurs retenues pour ce tournoi**.

## Fonctionnement

- Le bouton flottant « ? » de `/tournois/[id]` (`components/rules/RulesHelpFab.tsx`) pointe vers `/regles/<mode>?tournoi=<id>` (`rulesHrefWithTournament`).
- La page lit `?tournoi=` par `parseRulesTournamentParam` (entier positif en base 10, rien d'autre), puis l'instantané par `getVisibleTournamentSnapshot` — **la même porte que la fiche** : il faut être connecté, et un tournoi non publié n'existe que pour la permission `tournaments`. Tout refus ou toute panne de lecture rend simplement la page générale du mode.
- `tournamentSettingsGroups` (`lib/shared/tournament-settings.ts`, pur) rédige trois groupes : **Tournoi** (jeu, mode, participants, effectif maximal, format des matchs, ordre de départ), **le mode** (petite finale, cadence des coupes, rondes et barème suisse, capital / barème / qualifiées / plafond / format des play-offs de BlueGenji Survie, une ligne par phase en multi-phases) et **Conditions d'inscription**. Un groupe vide n'est pas rendu.

Rien n'est exposé qui ne le soit déjà : toutes ces valeurs voyagent dans l'instantané diffusé à tout lecteur du tournoi. L'URL canonique de la page reste `/regles/<mode>`.

## Voir aussi

- `lib/shared/tournament-rules.ts` : registre des règles (règles communes : lancement d'un match, format des matchs, report des scores, forfait, double forfait).
- Le mode `SURVIVAL` s'affiche désormais **« Survie par coupes »** partout (`FORMAT_LABELS`, formulaires, statistiques, règles), pour ne plus se confondre avec **BlueGenji Survie**. Le slug `/regles/survie` est inchangé.
