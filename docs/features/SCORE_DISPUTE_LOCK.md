# Litige de score verrouillé et validation d'office (2 h)

Deux règles du cycle proposer / confirmer / contester (`PLAYER_SCORE_ENTRY.md`),
décidées le 2026-10-13.

## 1. Litige : saisie verrouillée pour les deux équipes

Deux propositions **ensemble** sur un match ouvert se contredisent toujours —
deux propositions concordantes le tranchent dans la transaction même
(`reportMatchScore`). Le litige se lit donc sur les seules colonnes de report
(`lib/shared/score-dispute.ts`, `isScoreDisputed`), **sans colonne de plus** :
toute remise à zéro (arbitrage, retour en arrière, réappariement d'une ronde)
efface les propositions et referme le litige.

Tant qu'il est ouvert, **aucune** des deux engagées ne peut proposer, corriger,
confirmer ni déclarer forfait sur la manche :

| Route | Refus |
|---|---|
| `POST /api/tournaments/[id]/matches/[matchId]/report` | `409 SCORE_LOCKED_DISPUTE` |
| `POST /api/tournaments/[id]/matches/[matchId]/forfeit` | `409 SCORE_LOCKED_DISPUTE` |

Le contrôle est fait **sur la ligne verrouillée** du match (`FOR UPDATE`, table
seule — MariaDB) : `assertNoOpenDispute` dans `lib/server/tournaments/scoring.ts`,
le même prédicat dans `player-forfeit.ts`.

Seul l'arbitrage tranche : la route `POST /api/admin/matches/[matchId]/resolve`
(`can(user, "tournaments")` — arbitres et administrateurs, règle existante ;
pas d'affectation d'arbitre par match dans le code) fixe le score final ou
prononce un forfait, et `adminResolveMatch` → `finalizeMatch` efface les
propositions. L'alerte « conflit de score » aux arbitres (`REFEREE_ALERTS.md`,
push `REFEREE_ALERT` + Discord, staff anonymisé) part comme avant à
l'ouverture du litige, et l'escalade « toujours pas tranché » aussi.

**Écran.** Le litige se déduit de l'instantané commun (`team1Report` /
`team2Report`) : il voyage par le flux SSE **et** par la lecture REST de
secours, sans droit de lecteur à câbler. La carte dit « Score en litige ·
saisie verrouillée, arbitrage attendu » ; son bouton devient « Voir le litige » ;
la modale garde l'état du désaccord et le détail adverse, retire la saisie, le
bouton d'envoi et le forfait, et dit qui peut trancher (arbitre ou
administrateur du tournoi).

## 2. Validation d'office après 2 h de silence

Quand **une seule** équipe a saisi un score et que l'autre ne fait **rien**
(ni confirmation, ni contre-score — donc ni litige), le score est validé
d'office, exactement comme si l'autre l'avait confirmé.

- **Échéance** (`score_deadline_at`, existante) : la plus lointaine de
  `maintenant + SCORE_AUTO_VALIDATE_MINUTES` (120) et de la fin de série
  plausible (`lancement + 15 min × plafond de maps + SCORE_REPORT_TIMEOUT_MINUTES`,
  `lib/shared/score-report-deadline.ts`). Calculée en SQL par
  `scoreDeadlineAssignment` et **recalculée à chaque saisie** de l'équipe seule à
  avoir reporté : l'adversaire a toujours deux heures face à la version qu'il lit,
  et le déclarant ne peut que retarder la sienne (la durée ne dépend jamais du
  score). Un contre-score la ramène à `maintenant + 10 min` — elle ne sert plus
  alors qu'à l'escalade du litige.
- **Clôture** (`resolveExpiredScoreReports`, `lib/server/tournaments/finalization.ts`) :
  un **seul `UPDATE` conditionnel** (`claimAutoValidation`) écrit le résultat si
  la ligne est toujours `AWAITING_CONFIRMATION`, l'échéance passée, la **même**
  saisie (`teamN_reported_at` et score, comparés par `<=>`) et rien du côté
  adverse ; `affectedRows = 1` décide qui poursuit. Deux balayages parallèles,
  un redémarrage ou une confirmation tardive ne tranchent donc jamais deux fois
  (une confirmation arrivée après lit `COMPLETED` → `MATCH_ALREADY_COMPLETED`).
  Puis la suite d'une confirmation : `promoteReportedMaps`, `finalizeMatch(…,
  { resultWritten: true })` (journal `match_finished`, propagation dans le
  plateau, nettoyage des maps), réconciliation des modes à classement et
  annonce SSE par l'entretien existant (`./state.ts`, `contentChanged`).
- **Aucun processus nouveau** : l'entretien passif et les balayages existants
  (`findDueMaintenance`, `./sync-scope.ts`) repèrent déjà `score_deadline_at <= NOW()`.
- **Notification** : après le commit (`auto-validated-notices.ts`, vidé avec
  `flushBotLogs`, jeté avec `discardBotLogs`), push « Score validé
  automatiquement » aux responsables de match des **deux** équipes
  (`notifyScoreAutoValidated`, sujet existant `SCORE_TO_CONFIRM`, rédacteur
  `scoreAutoValidatedPush`, FR + EN, sans nommer personne). Rien sur Discord de
  plus que la ligne `match_finished` habituelle.
- **Écran** : « Validé automatiquement à HH:MM » à l'**heure de Paris**
  (`autoValidateTimeText`) sur la carte (lisible de tous) et dans la modale des
  deux équipes (« (Paris time) » en anglais).

## Règles du tournoi

`/regles` (FR + EN, `messages/*/rules.json`, valeur `{autoValidate}` tirée de
la constante) décrit les deux règles. Les conditions d'utilisation ne parlent
pas du report de score : inchangées.

## Fichiers

- `lib/shared/score-dispute.ts` — prédicat du litige, code, heure de Paris.
- `lib/server/tournaments/scoring.ts` — verrou, échéance, `finalizeMatch` scindé.
- `lib/server/tournaments/finalization.ts` — `claimAutoValidation`.
- `lib/server/tournaments/player-forfeit.ts`, `auto-validated-notices.ts`, `player-pushes.ts`.
- `app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx`, `MatchRow.tsx`.

## Tests

`tests/lib/shared/score-dispute.test.ts`, `score-report-deadline.test.ts`,
`player-score-report.test.ts` ; `tests/lib/server/score-report-stalled.test.ts`
(UPDATE conditionnel, idempotence, course perdue), `tournaments-service.matches.test.ts`
(verrou des deux équipes, confirmation refusée, propagation `resultWritten`),
`player-forfeit.test.ts`, `auto-validated-notices.test.ts` ;
`tests/app/api/tournaments/report-score.test.ts`, `match-forfeit.test.ts`,
`tests/app/api/admin/dispute-resolution.test.ts` (arbitre et admin tranchent,
capitaine refusé).
