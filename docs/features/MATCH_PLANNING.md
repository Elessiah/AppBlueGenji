# Planification des matchs par l'arbitrage

Option de tournoi : **tous les matchs passent par un arbitre ou un admin**, qui
fixe leur date et leur heure avant qu'ils ne se lancent.

Code : `lib/shared/match-planning.ts` (pur), `lib/shared/match-launch.ts`
(phase `TO_PLAN`, `isScoreEntryOpen`), `lib/server/tournaments/referee-scheduling.ts`
(bascule), `lib/server/tournaments/match-schedule.ts` (pose de la date),
`app/(secured)/tournois/[id]/_components/MatchPlanningPanel.tsx` et
`MatchLaunchStrip.tsx` (interface).

## Le cycle d'un match

| Option éteinte (défaut) | Option allumée |
|---|---|
| Jouable sans date → **Lancement** | Jouable sans date → **À planifier** |
| Date future → **En attente de départ** | Date posée par l'arbitrage → **En attente de départ** |
| Heure atteinte → **Lancement** | Heure atteinte → **Lancement** |
| « Prêt » / forçage / 15 min → **Lancé** | idem |

L'état n'est **jamais stocké** : `matchLaunchPhase` le dérive de l'option
(`bg_tournaments.referee_scheduling`, `TINYINT NOT NULL DEFAULT 0`), de
`start_at` et de `launched_at`. `MatchLaunchInput.refereeScheduling` est
**obligatoire** : un appelant qui l'oublierait ouvrirait le lancement d'un match
que personne n'a planifié.

## Modifier l'option en cours de tournoi

Réglée à la création (case « Matchs planifiés par l'arbitrage » du formulaire),
elle se bascule ensuite dans tous les états sauf `FINISHED` — y compris
`RUNNING` —, par une seule route (`PUT /api/admin/tournaments/[id]/referee-scheduling`)
et depuis deux endroits :

- le **panneau de la fiche** (« Activer / Désactiver la planification ») ;
- le formulaire **« Modifier le tournoi »**, qui porte la même case
  (`RefereeSchedulingField`). La case survit à la fenêtre d'édition : le bouton
  « Modifier » reste affiché sur un tournoi lancé (`canShowEditButton`), le
  formulaire y est rendu grisé **sauf** cette case, et la page n'envoie alors
  que la bascule — jamais `PATCH .../edit`, que la fenêtre fermée refuserait.
  La case part **à chaque** enregistrement, pas seulement quand elle diffère de
  la lecture d'ouverture (qu'un arbitre a pu changer depuis la fiche entre-temps) :
  la route est donc **idempotente** — sans changement, elle n'écrit, ne journalise
  ni ne publie rien, et rend `changed: false`, que la confirmation lit pour ne
  pas annoncer « modifié » quand rien ne l'a été (`editSavedMessage`).
  Cochée sur un tournoi en cours, la case annonce avant l'enregistrement les
  lancements qu'elle défera (`ENABLE_PLANNING_WHILE_RUNNING_WARNING`). La
  lecture d'édition (`loadEditableTournament`) rend l'option et l'état **à côté**
  des valeurs éditables, dont elle ne fait pas partie.

- **Allumer** : les matchs jouables, **non lancés et sans date**, repassent « À
  planifier » — leur ouverture de lancement et leurs « Prêt » sont effacés dans
  la même transaction (sinon le délai de quinze minutes, déjà écoulé, les ferait
  partir d'office dès leur planification). Les matchs **lancés** continuent, et
  un match en lancement qui porte déjà un score noté par l'arbitrage est tenu
  pour lancé (la rencontre a eu lieu) plutôt que renvoyé à planifier. Les
  manches suivantes naissent à planifier. En cours de tournoi, la fiche demande
  confirmation en disant combien de matchs sont concernés.
- **Éteindre** : rien n'est réécrit ; les matchs sans date entrent en lancement.

## Planifier

La date se pose par le dialogue existant (`PUT /api/admin/matches/[id]/schedule`),
ouvert depuis le bouton **« 🗓 Planifier »** de la carte d'un match à planifier ou
depuis **« Planifier le prochain »** du panneau de la fiche (premier match à
planifier dans l'ordre du plateau). Déplacer une date dans le futur, ou l'effacer
option allumée, fait **quitter le lancement** : ouverture et « Prêt » sont
effacés sous le verrou de la ligne du match — sauf si un score est déjà noté :
le match est alors tenu pour lancé. Défaire un lancement efface aussi la
réservation de sa notification de départ (`bg_match_start_notices`), pour que
la nouvelle heure prévienne de nouveau les joueurs. L'arbitrage peut aussi **forcer** le
lancement d'un match à planifier — forcer vaut planification.

## Aucun score avant le lancement — dans tous les cas

`SCORE_ENTRY_CLOSED_PHASES` = `TO_PLAN` + `SCHEDULED`, **quelle que soit
l'option** :

- les joueurs ne reportent qu'un match lancé (règle antérieure, inchangée) ;
- l'arbitrage est refusé en `409 MATCH_NOT_IN_LAUNCH` sur « Enregistrer » et
  « Valider le résultat » avec scores (`assertScoreEntryOpen`,
  `lib/server/tournaments/admin.ts`) ;
- le **forfait** (simple, double, ou déclaré par un engagé) reste ouvert : une
  équipe absente n'a pas à attendre l'heure ;
- un match **terminé** reste corrigible (phase `NONE`).

Le dialogue d'arbitrage ferme les champs de score et déplie le forfait ; il
s'ouvre de lui-même à l'heure dite, la phase suivant l'horloge.

## Interface

- **Carte de match** (`MatchLaunchStrip`) : « 📅 À planifier » (ambre) et, pour
  l'arbitrage, « 🗓 Planifier » ; « ⏱ En attente de départ » (bleu) ; puis
  « Lancement » et « Lancé » comme avant.
- **Panneau de la fiche** (`MatchPlanningPanel`), sous la frise : annonce la règle
  à tous quand l'option est allumée ; pour l'arbitrage, l'interrupteur, le
  nombre de matchs à planifier et « Planifier le prochain ».
- La **modale globale de lancement** ignore les matchs à planifier : rien à
  guetter, aucun « Prêt » à donner, aucun contact à exposer.

## Performance

- Un match à planifier n'est **jamais** une tâche due du balayage passif
  (`sync-scope.ts`) ni un candidat de `maintainMatchLaunches` ou de la modale
  (`AND (m.start_at IS NOT NULL OR t.referee_scheduling = 0)`) : sans ce filtre,
  un plateau entier à planifier ferait entretenir son tournoi à chaque passe.
- Côté client, `TO_PLAN` n'a aucune minuterie (`nextLaunchPhaseChangeAt` rend
  `null`) ; `SCHEDULED → LOBBY` garde son unique `setTimeout`.
- La **salle du flux** se réveille à l'heure de départ d'un match en attente et à
  son lancement d'office (`launchDeadlinesOf`, `nextRoomWakeAt`), avec un
  rattrapage unique si la lecture de l'heure venait du cache — le lancement
  d'office arrivait sinon jusqu'à cinq minutes en retard.

## Droits

Voir `docs/AUTHORIZATION_RULES.md` §4.10. Tout passe par la permission
`tournaments` (arbitre, admin) ; un caster (`live`) ne planifie pas. La bascule
est journalisée (`publishStaffAction` : anonyme sur Discord, nominative dans pm2).
