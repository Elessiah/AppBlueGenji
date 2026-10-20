# Litige de score verrouillé et validation d'office (2 h)

Deux règles du cycle proposer / confirmer / contester (`PLAYER_SCORE_ENTRY.md`),
décidées le 2026-10-13.

## 1. Litige : saisie verrouillée pour les deux adversaires

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
l'ouverture du litige, et l'escalade « toujours pas tranché » aussi — son texte
(`refereeAlert.score_report_stalled`, FR + EN ; ligne Discord « litige toujours pas
tranché, délai dépassé depuis plus de N minutes — saisie verrouillée ») dit un **litige** sans arbitrage,
saisie verrouillée : elle ne part plus que pour un litige, un report seul étant
validé d'office.

**Écran.** Le litige se déduit de l'instantané commun (`team1Report` /
`team2Report`) : il voyage par le flux SSE **et** par la lecture REST de
secours, sans droit de lecteur à câbler. La carte dit « Score en litige ·
saisie verrouillée, arbitrage attendu » ; son bouton devient « Voir le litige »,
icône œil et ton neutre (`readOnly`, `match-card-actions.ts`), ni crayon ni bouton plein : rien ne s'y édite — et elle cède la place visible au
geste d'arbitrage — et à lui seul — quand le lecteur en a un (`groupMatchCardActions`) ;
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
codes de replay compris : la saisie retirée, c'est la seule trace des siens (détail
encore en lecture : la phrase d'état le dit, `conflictLoading`, FR + EN). L'avis dit ce que l'arbitrage peut faire depuis la carte :
valider le score final ou un forfait (aucune remise à zéro par match
n'existe ; le retour en arrière du tournoi en est une, plus large).

**Abandon du tournoi** (décision du 2026-10-20, close). Le verrou vise le
forfait **du match** ; l'abandon du tournoi (Survie, Ronde suisse, BG Survie,
phase MULTI) reste ouvert pendant un litige et clôt la manche en litige comme
une défaite de l'équipe qui abandonne — elle concède, personne d'autre n'y
perd. Comportement inchangé, voulu ; /regles le dit (FR + EN : « Abandonner le
tournoi, là où le format le permet, reste possible pendant un litige… »).

**Arbitre qui joue** (décision du 2026-10-20). Un membre du staff
(`tournaments`) qui joue la manche en litige — membre actuel d'une des deux
équipes, ou joueur de l'entrée solo (`loadEntrantPlayerIds`) — peut la
trancher : une petite organisation n'a pas toujours un arbitre neutre. Mais les
**autres** sont avertis, après le commit et au meilleur effort
(`lib/server/tournaments/dispute-self-resolution.ts`, appelé par
`adminResolveMatchPublic` avec l'arbitre de la session) :

- push `REFEREE_SELF_RESOLUTION` (`notifyStaff`, l'auteur exclu ; rédacteur
  `selfResolvedDisputePush`, FR + EN) : « Un membre du staff qui joue ce match a
  tranché son litige · tournoi, manche : issue. » — issue = « Équipe A 2 – 1
  Équipe B », « forfait de Équipe B », « double forfait » ; en individuel,
  aucun nom (« 2 – 1 », « forfait d'un joueur ») ;
- journal (`publishStaffAction`) : la même ligne en français sur Discord, staff
  anonyme et noms d'équipe neutralisés (`discordInline`), et nominative dans
  pm2 (`[staff-audit] … — auteur : <pseudo> (#id)`).

Le litige se lit **sous le verrou** de la manche, avant l'arbitrage (deux
propositions sur un match ouvert, `isScoreDisputed`) : un arbitrage hors litige
— ou par un arbitre qui ne joue pas — n'avertit personne. Seul « Valider le
résultat » est concerné : « Enregistrer » ne tranche rien.

**Arbitre et report seul** (décision du 2026-10-20). « Enregistrer »
(avancement ou forfait noté, sans trancher) sur une manche où **une seule**
engagée a reporté **suspend** la validation d'office : le score du déclarant ne
remplace plus, à l'échéance, ce que l'arbitre a noté.

- **Suspension** : `bg_matches.score_validation_paused_at = NOW()`, posée par
  `pauseAutoValidation` (`admin.ts`) dans la transaction d'« Enregistrer », sur
  la ligne déjà verrouillée, si le match est `AWAITING_CONFIRMATION` avec un
  report seul (`SINGLE_REPORT_SQL`). Un litige garde son escalade ; un match
  sans proposition n'a rien à suspendre.
- **Balayage** : la validation d'office reste **un seul `UPDATE`
  conditionnel** (`claimAutoValidation`), sa condition ajoute
  `score_validation_paused_at IS NULL` ; la sélection partagée
  (`ACTIONABLE_EXPIRED_REPORT_SQL`) aussi (`AUTO_VALIDATION_RUNNING_SQL`), si
  bien qu'un report suspendu ne rend plus le tournoi « dû ». Course avec
  l'arbitre : le balayage qui passe avant ferme la manche et « Enregistrer »
  reçoit `MATCH_ALREADY_COMPLETED` ; sinon son `UPDATE` attend le commit de
  l'arbitre et ne touche plus rien. Idempotent.
- **Fin de la suspension** : seul l'arbitrage la lève — « Valider le résultat »
  tranche. La réponse de l'adversaire referme le report seul comme avant
  (confirmation : match clos ; contre-score : litige, avec son escalade). Une
  **resaisie du déclarant ne relance pas** le délai (sans quoi il annulerait
  d'un clic l'arrêt décidé par l'arbitre) ; un report **neuf** — aucune
  proposition en cours, après un arbitrage ou un retour en arrière qui les a
  effacées — efface la marque restée (`pauseResetAssignment`, `scoring.ts`).
- **Écran** (FR + EN, instantané commun : `scoreAutoValidationPaused`, calculé
  par `AUTO_VALIDATION_PAUSED_SQL`, donc par le flux et la lecture REST) : la
  carte dit « … proposé par X · validation automatique suspendue par
  l'arbitrage » / « … automatic confirmation paused by a referee » au lieu de
  l'heure ; la modale des deux équipes « Validation automatique suspendue par
  l'arbitrage : sans réponse, un arbitre validera le résultat. » ; la fenêtre
  d'arbitrage le dit dans un avis à part (la saisie de l'arbitre efface l'avis
  de proposition). Dès qu'un avancement d'arbitrage est noté sur un report
  seul — avant ou après la proposition, suspendu ou non
  (`singlePendingReport`) —, la fenêtre garde la proposition lisible (score,
  maps, codes de replay), offre « Reprendre la proposition de X » / « Use X's
  proposal » (maps chargées dans le formulaire, `adoptReport`) et, tant que
  rien n'est suspendu, prévient que « Enregistrer » suspendra la validation
  (`score.admin.saveWillPause`, dit aussi sous une proposition pré-remplie
  intacte ; détail des maps en lecture : `score.admin.awaitingDetail`) ; le bouton de la carte reste « Valider le
  score proposé ». L'alerte au staff nomme une ronde suisse, phase d'un
  `MULTI` comprise, par `swissRoundSql` ; l'avis « proposition
  modifiée » dit « « Enregistrer » note ta saisie et suspend la validation
  automatique de cette proposition ; seul « Valider le résultat » tranche, à
  moins que {adversaire} ne la confirme. ». Rouvert sur un report suspendu,
  l'avis « Enregistré : X, non tranché » dit que les champs portent la saisie
  d'un arbitre, et non la proposition.
  La notification d'« Enregistrer » dit la suspension quand elle a eu lieu
  (`autoValidationPaused` dans la réponse de `PATCH …/scores`,
  `score.admin.savedPaused`). Une resaisie du déclarant pendant la suspension
  prévient l'adversaire sans promettre de validation automatique
  (`scoreToConfirm.bodyPaused`). Le réveil du flux ignore une échéance suspendue
  (`tournament-broadcast.ts`).

**Avant l'envoi.** Une contre-proposition ne se corrige plus : face à la
proposition adverse, toute saisie qui en diffère (score, ou seulement le détail
des maps ; détail adverse encore en lecture ou illisible : seulement un score
différent, le serveur comparant lui-même le détail) affiche, au-dessus des actions, « Cette saisie diffère de la
proposition de … (score ou détail des maps) : l'envoyer ouvre un litige
et verrouille la saisie des deux adversaires jusqu'à l'arbitrage » (FR + EN,
`score.player.counterWarning`, rattaché au bouton d'envoi par `aria-describedby`), et la phrase d'état (`theirs.withMaps` /
`withoutMaps`) le dit dès l'ouverture. Pendant un envoi, les boutons
`aria-disabled` se grisent comme `:disabled` (`ScoreDialog.module.css`).
L'avis de verrou suit le désaccord dans **la** région d'état de la modale,
déjà montée par la proposition qui précédait : un litige arrivé par le flux est
annoncé une fois, où que soit le focus. Un refus
`SCORE_LOCKED_DISPUTE` ou `MATCH_ALREADY_COMPLETED` (validation d'office passée
à l'heure dite ; envoi ou forfait) relit l'état comme `PROPOSAL_STALE`,
sans attendre un flux peut-être en reconnexion.
Match tranché sous la modale ouverte (validation d'office, arbitrage,
confirmation adverse) : elle se referme avec « Ce match vient d'être tranché :
la fenêtre de score s'est refermée » (`useCloseSettledPlayerScore`,
`TournamentSheet.tsx`) — jamais pour une modale déjà disparue, ni quand c'est
l'envoi ou le forfait du lecteur qui tranche (`onOwnSettle`, y compris un refus
`MATCH_ALREADY_COMPLETED`, qui a déjà son toast, et un échec sans code rendu —
réseau coupé, 502 — dont l'issue est inconnue).

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
  annonce SSE par l'entretien existant (`./state.ts`, `contentChanged`). Le
  format de manche se lit une fois par ronde dans un balayage, pas par match.
- **Reports en vol au déploiement** : un report seul déposé sous l'ancienne
  règle (fin de série plausible + 10 min) aurait été validé dans les minutes
  suivant le déploiement. Un rattrapage joué au démarrage a porté son échéance
  à la saisie + 2 h ; il a tourné au déploiement de la PR #453 (production,
  2026-10-20) et a été retiré ensuite, le nouveau code n'écrivant jamais
  d'échéance plus proche. Le seed des reports expirés date toujours sa saisie
  de 2 h 10 (au-delà des deux heures). **Restauration d'une sauvegarde prise
  avant ce déploiement** : rejouer ce rattrapage n'apporterait rien — une telle
  archive (hebdomadaire, la dernière du 2026-10-19 à 03:00) ne peut être
  restaurée que plus de deux heures après chaque saisie qu'elle contient, si bien que
  « saisie + 2 h » est déjà passé et que ses reports seuls en attente sont
  validés d'office au premier démarrage, avec ou sans lui.
- **Colonnes de clôture partagées** (`MATCH_RESULT_SET_SQL`,
  `score-report-sql.ts`) : la validation d'office et l'accord des deux engagés
  écrivent la même liste, `forfeit_team_id = NULL` compris — un forfait noté
  par l'arbitrage (« Enregistrer ») ne survit pas au score des joueurs.
- **Aucun processus nouveau** : l'entretien passif et les balayages existants
  (`findDueMaintenance`, `./sync-scope.ts`) repèrent déjà `score_deadline_at <= NOW()`.
  Un litige **déjà escaladé** n'y compte plus (`ACTIONABLE_EXPIRED_REPORT_SQL`,
  partagé avec l'instantané et la résolution) : il peut durer des heures sans
  rien coûter d'autre que sa lecture (`TOURNAMENT_SYNC_SCOPE.md`).
- **Notification** : après le commit (`auto-validated-notices.ts`, vidé avec
  `flushBotLogs`, jeté avec `discardBotLogs` ; avis envoyés **l'un après
  l'autre** dans une file unique au processus, sans plafond, pour qu'une ronde
  entière — ou plusieurs tournois d'un même balayage — n'occupe qu'une connexion
  du pool), push « Score validé
  automatiquement » aux responsables de match des **deux** équipes
  (`notifyScoreAutoValidated`, sujet existant `SCORE_TO_CONFIRM`, rédacteur
  `scoreAutoValidatedPush`, FR + EN, sans nommer personne ni « l'autre équipe » :
  le même texte part aux deux camps — « personne ne l'a confirmé ni contesté
  avant l'échéance » — sans durée : sur un format long, l'échéance dépasse 2 h ;
  le sujet du profil et la modale avant toute saisie (`willConfirm`) disent « après au moins 2 h »). Le push « Score à confirmer »
  prévient d'avance : « sans réponse, il sera validé automatiquement » (sans heure). L'avis porte le score écrit par la validation : il se tait si la manche, au
  moment de partir, n'est plus close ou porte un autre résultat (arbitre qui a
  retranché sur un autre score ou un forfait après un retour en arrière) — il
  aurait attribué à la validation d'office une décision de l'arbitrage. Rien sur Discord de
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
- `lib/server/tournaments/score-report-sql.ts` — prédicats partagés, suspension comprise.
- `lib/server/tournaments/admin.ts` — `pauseAutoValidation` ; `dispute-self-resolution.ts` — arbitre qui joue.
- `lib/server/tournaments/player-forfeit.ts`, `auto-validated-notices.ts`, `player-pushes.ts`.
- `app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx`, `MatchRow.tsx`.

## Tests

`tests/lib/shared/score-dispute.test.ts`, `score-report-deadline.test.ts`,
`player-score-report.test.ts` ; `tests/lib/server/score-report-stalled.test.ts`
(UPDATE conditionnel, idempotence, course perdue), `tournaments-service.matches.test.ts`
(verrou des deux équipes, confirmation refusée, propagation `resultWritten`),
`player-forfeit.test.ts`, `auto-validated-notices.test.ts`,
`player-pushes.test.ts` (avis muet sur un résultat retranché),
`auto-validate-deadline-migration.test.ts` (rattrapage des échéances) ;
`tests/app/tournament-actions-i18n.test.tsx` (modale verrouillée et heure de Paris, FR + EN) ;
`tests/app/api/tournaments/report-score.test.ts`, `match-forfeit.test.ts`,
`tests/app/api/admin/dispute-resolution.test.ts` (arbitre et admin tranchent,
capitaine refusé, arbitre transmis au service) ;
`tests/lib/server/dispute-self-resolution.test.ts` (alerte aux autres
seulement, rien hors litige ni pour un arbitre qui ne joue pas, journal) ;
`tournaments-public-writes.test.ts` (litige lu sous verrou, alerte après le
commit, rien hors litige) ; suspension : `admin-score-guards.test.ts`
(« Enregistrer » la pose sur un report seul), `score-report-stalled.test.ts`
(balayage muet, course perdue), `tournaments-service.matches.test.ts` (resaisie
qui la garde, report neuf qui la lève), `tournament-broadcast-wake.test.ts`,
`player-score-report.test.ts` et `tournament-actions-i18n.test.tsx` (écran,
FR + EN) ; `dispute-withdrawal.test.ts` (abandon inchangé, /regles).
