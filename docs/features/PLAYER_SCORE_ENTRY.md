# Saisie du score par un joueur

Modale « Score de mon match » : le pendant, pour les engagés, du dialogue
d'arbitrage (`SCORE_EDIT_DIALOG.md`).

## Le problème

Le report d'un joueur passait par un formulaire en ligne sous la carte du match :
deux champs numériques de 52 px, sans libellé visible, et un bouton « Envoyer le
score ». Le serveur enregistrait bien la proposition (`team1_report_score` …),
mais **l'instantané ne la transportait pas** : une fois envoyé, rien ne
changeait à l'écran — ni chez l'expéditeur, ni chez l'adversaire qui devait la
confirmer. Le score avait l'air d'être perdu. Le forfait, lui, n'avait aucune
porte côté joueur.

## Le cycle, désormais visible

1. **Proposer.** L'engagé ouvre la modale (« Saisir le score ») une fois le
   match lancé, saisit le score dans l'orientation du plateau (équipe 1 à gauche,
   équipe 2 à droite), et l'envoie. Les champs s'ouvrent **vides**, jamais sur
   un « 0 – 0 » inventé.
2. **Confirmer.** L'adversaire voit « Confirmer le score » sur la carte ; la
   modale s'ouvre sur la proposition, un clic la valide et tranche le match.
3. **Contester.** Il peut aussi saisir un autre score : les deux propositions se
   contredisent, l'arbitrage est alerté (`REFEREE_ALERTS.md`), et chacun peut
   encore corriger la sienne (« Revoir le score »).
4. **Sans réponse**, la proposition fait foi à l'échéance du délai
   (`score_deadline_at`, rappelé dans la modale). Ce délai ne court qu'après une
   fin de série plausible — une série **complète** au format de la manche,
   15 min par map de son plafond (BO5 en saisie libre), depuis le lancement
   (`lib/shared/score-report-deadline.ts`) : un « 3-0 » envoyé à la seconde du
   lancement ne fait pas foi avant que la série ait pu se jouer. L'échéance se
   lit sur le format et non sur le score déclaré, qui la mettait à la main du
   déclarant ; elle est posée une fois, au premier report.

Proposer, confirmer et contester reviennent à **ceux qui mènent le match** :
`CAPITAINE`, `MANAGER` ou `OWNER` — les rôles qui déclarent l'équipe prête
(`canDeclareTeamReady`) —, ou le joueur en individuel. Un 0-3 déclaré contre
soi est un forfait : une simple place au roster n'y suffit pas. Un membre
sportif ne voit pas le bouton (`canCreateReportsForTeamIds` vide), et la route
le refuse en `403 NOT_TEAM_MATCH_LEADER`. Pour la même raison, « score à
confirmer » ne prévient que ceux qui peuvent y répondre : le push
(`notifyScoreToConfirm`, par `loadEntrantMatchLeaderIds`) comme l'alerte de page
(`viewerAlert`, sur `canCreateReportsForTeamIds`). Le forfait sur la manche,
lui, reste au propriétaire et aux managers.

La carte porte une ligne d'état **lisible de tous** (« 2 – 1 proposé par Alpha ·
à confirmer », « Scores contradictoires · arbitrage alerté ») : sans elle, un
match joué et reporté se lisait comme un match pas encore joué.

## Données

`BracketMatch.team1Report` / `team2Report` (`MatchScoreReport | null`) : la
proposition de chaque engagée, **retournée dans l'orientation du plateau** par
`mapMatch` — le stockage parle depuis l'engagée (« mon score », « score
adverse »), la conversion n'est écrite qu'une fois, à la sérialisation. Elles
voyagent dans l'instantané, donc par le flux SSE : la proposition adverse arrive
pendant que la modale est ouverte, et remplit les champs tant que le lecteur n'y
a rien touché.

## Forfait sur la manche

« Déclarer forfait sur ce match », replié dans la modale, puis confirmé. Il perd
**cette** rencontre au score plein du format (FT3 → 0-3) — ce n'est pas l'abandon
du tournoi (`POST /api/tournaments/[id]/forfeit`).

- Route : `POST /api/tournaments/[id]/matches/[matchId]/forfeit`, **sans corps** :
  l'équipe est celle du joueur connecté, jamais une autre. Accuser l'adversaire
  de ne pas s'être présenté est une contestation, qui passe par « Signaler un
  problème ».
- Service : `lib/server/tournaments/player-forfeit.ts` (`forfeitOwnMatch`) —
  vérifie tournoi en cours, engagé, qualité (`OWNER` / `MANAGER`, ou le joueur
  en individuel — `NOT_TEAM_MANAGER` sinon), match ouvert et à deux équipes,
  verrouille la ligne, puis **délègue à `adminResolveMatch`**, seul chemin qui
  sache trancher un forfait. La transaction est suivie de la même chaîne que le
  report d'un score (`runPlayerMatchWrite`, `lib/server/tournaments/index.ts`).
- **Pas besoin que le match soit lancé** : l'équipe qui ne pourra pas se
  présenter le sait avant le coup d'envoi. Avant le lancement, la modale
  n'offre donc que le forfait, et le bouton de la carte s'intitule « Déclarer
  forfait » — pour qui a qualité seulement.

| Code | Statut |
|---|---|
| `NO_ACTIVE_TEAM`, `TOURNAMENT_NOT_RUNNING`, `MATCH_NOT_READY`, `NOT_IN_MATCH` | 400 |
| `NOT_TEAM_MANAGER` | 403 |
| `MATCH_ALREADY_COMPLETED`, `CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES` | 409 |
| `TOURNAMENT_NOT_FOUND`, `MATCH_NOT_FOUND` | 404 |

## Fichiers

- `lib/shared/player-score-report.ts` — module pur : état du cycle vu par le
  lecteur (`playerReportView`), valeurs d'ouverture, conversion vers le contrat
  de la route, libellé du bouton, ligne d'état, ouverture de la modale.
- `app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx` — la modale.
- `_components/ScoreStepper.tsx` + `ScoreDialog.module.css` — partagés avec
  `AdminScoreDialog` (une seule implémentation du stepper et du gabarit).
- `_lib/player-score-context.tsx` — droit et ouverture diffusés par contexte
  jusqu'à `MatchRow`, au lieu des quatre props (brouillons, saisie, envoi,
  droit) que les six vues du plateau relayaient.

## Tests

- `tests/lib/shared/player-score-report.test.ts`, `tests/lib/server/player-forfeit.test.ts`,
  `tests/app/api/tournaments/match-forfeit.test.ts`, `tests/tournois/tournament-mappers.test.ts`.
- **E2E** `e2e/player-journey.spec.ts` : deux joueurs réels (chacun sa session)
  inscrivent leur équipe, lancent le match, proposent et confirment un score,
  se contredisent, et déclarent forfait. Voir `e2e/README.md`.
