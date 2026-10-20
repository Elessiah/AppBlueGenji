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
administrateur — la permission de plateforme `tournaments`, pas l'organisateur),
en **validant** le score final ou un forfait. La fenêtre d'arbitrage le rappelle
sous les deux propositions (`score.admin.disputeNotice`) : « Enregistrer » garde
les propositions, donc le verrou ; seul « Valider le résultat » le lève.
Désaccord et verrou partagent la région d'état de la modale joueur (une seule
annonce).
Le bouton dit « Voir le litige » même à qui ne peut que déclarer forfait
(`playerScoreButtonKey` lit le litige d'abord) : la modale n'offre plus ce
geste. Litige arrivé par le flux pendant une saisie : le focus, resté sur un
champ qui disparaît, revient à la modale (l'avis s'annonce par la région
d'état, une seule fois). La modale en litige montre **les deux** propositions,
codes de replay compris : la saisie retirée, c'est la seule trace des siens. L'avis dit ce que l'arbitrage peut faire depuis la carte :
valider le score final ou un forfait (aucune remise à zéro par match
n'existe ; le retour en arrière du tournoi en est une, plus large).

**Abandon du tournoi.** Le verrou vise le forfait **du match** ; l'abandon du
tournoi (Survie, Ronde suisse, BG Survie, phase MULTI) reste ouvert et clôt la
manche en litige comme une défaite de l'équipe qui abandonne — elle concède,
personne d'autre n'y perd. /regles le dit « aucun forfait sur ce match ».

**Arbitre et report seul.** « Enregistrer » (avancement, sans trancher) ne
touche ni les propositions ni l'échéance : la règle des 2 h s'applique toujours,
et l'arbitre qui veut retenir un autre score le **valide** (« Valider le
résultat »). À l'échéance, le score du déclarant remplace ce qui a été noté —
forfait compris (`forfeit_team_id` remis à `NULL` : jamais un score de
déclarant sous un drapeau de forfait). Suspendre la validation d'office dès
qu'un arbitre enregistre reste une décision à prendre.

**Avant l'envoi.** Une contre-proposition ne se corrige plus : face à la
proposition adverse, toute saisie qui en diffère (score, ou seulement le détail
des maps ; détail adverse encore en lecture ou illisible : seulement un score
différent, le serveur comparant lui-même le détail) affiche, au-dessus des actions, « Cette saisie diffère de la
proposition de … (score ou détail des maps) : l'envoyer ouvre un litige
et verrouille la saisie des deux équipes jusqu'à l'arbitrage » (FR + EN,
`score.player.counterWarning`, rattaché au bouton d'envoi par `aria-describedby`), et la phrase d'état (`theirs.withMaps` /
`withoutMaps`) le dit dès l'ouverture. Pendant un envoi, les boutons
`aria-disabled` se grisent comme `:disabled` (`ScoreDialog.module.css`).
L'avis de verrou suit le désaccord dans **la** région d'état de la modale,
déjà montée par la proposition qui précédait : un litige arrivé par le flux est
annoncé une fois, où que soit le focus. Un refus
`SCORE_LOCKED_DISPUTE` ou `MATCH_ALREADY_COMPLETED` (validation d'office passée
à l'heure dite ; envoi ou forfait) relit l'état comme `PROPOSAL_STALE`,
sans attendre un flux peut-être en reconnexion.

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
  `scoreAutoValidatedPush`, FR + EN, sans nommer personne ni « l'autre équipe » :
  le même texte part aux deux camps — « personne ne l'a confirmé ni contesté
  avant l'échéance » — sans durée : sur un format long, l'échéance dépasse 2 h ;
  le sujet du profil dit « après au moins 2 h »). Le push « Score à confirmer »
  prévient d'avance : « sans réponse, il sera validé automatiquement » (sans heure). Rien sur Discord de
  plus que la ligne `match_finished` habituelle.
- **Écran** : sur la carte (lisible de tous), « validation automatique à HH:MM
  (heure de Paris) sans réponse » / « automatic confirmation at HH:MM (Paris
  time) without an answer » — un nom, pas un participe qui se lirait « déjà
  validé » ; dans la modale des deux équipes, « sera validé automatiquement à
  HH:MM (heure de Paris) » / « will be confirmed automatically at HH:MM (Paris
  time) » (`autoValidateTimeText`, mention du fuseau dans les deux langues).
- **Pendant un envoi** (score, forfait) : boutons `aria-disabled` + `aria-busy`,
  jamais `disabled` natif (le focus resterait sur un bouton éteint).

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
`tests/app/tournament-actions-i18n.test.tsx` (modale verrouillée et heure de Paris, FR + EN) ;
`tests/app/api/tournaments/report-score.test.ts`, `match-forfeit.test.ts`,
`tests/app/api/admin/dispute-resolution.test.ts` (arbitre et admin tranchent,
capitaine refusé).
