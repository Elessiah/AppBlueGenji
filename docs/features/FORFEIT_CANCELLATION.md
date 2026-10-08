# Annuler un abandon de tournoi

> `lib/server/tournaments/forfeit-cancellation.ts` ·
> `DELETE /api/admin/tournaments/[id]/forfeits/[teamId]` ·
> `app/(secured)/tournois/[id]/_lib/forfeit.ts` (`canCancelForfeits`,
> `requestForfeitCancellation`) · bouton dans `SurvivalView`, `SwissView`,
> `EnduranceView`

## Le problème

L'abandon d'un engagé pour tout le reste du tournoi
(`POST /api/tournaments/[id]/forfeit`, Survie, Ronde suisse, BlueGenji Survie)
ne se défaisait pas. Un abandon déclaré par erreur — mauvaise ligne cliquée par
l'arbitrage, capitaine revenu sur sa décision — laissait l'équipe sortie pour de
bon. Le forfait **sur un match** (`forfeit_team_id`), lui, se corrige déjà par le
dialogue de score.

## Ce que fait l'annulation

Une seule chose : l'engagé repasse de `FORFEIT` à `ACTIVE` (manche de sortie
remise à `NULL`), puis le moteur rejoue le classement (`reconcileSurvival`,
`reconcileSwiss`, `reconcileEndurance`, puis `reconcilePhases` en multi-phases).

Les trois moteurs relisent les abandons **depuis le statut stocké** : effacer le
statut suffit à rendre victoires, capital d'endurance et rang à ce que les matchs
disent. Si les matchs joués l'éliminaient (coupe en Survie, capital épuisé en
BG Survie), le rejeu l'élimine — l'abandon ne masquait rien d'autre.

**Le match clos par l'abandon reste perdu.** L'abandon l'avait terminé au score
plein du format, en faveur de l'adversaire ; ce résultat n'est pas touché. Le
rouvrir obligerait à revenir sur une manche que le tournoi a peut-être déjà
dépassée. L'arbitrage corrige ce score par le dialogue habituel si besoin, dans
les limites de `SCORE_EDIT_LOCK.md`. La modale de confirmation le dit.

L'équipe est appariée dès la **prochaine** manche posée par le moteur : dans la
manche en cours, elle n'a pas de match.

## Fenêtre

| Condition | Refus |
| --- | --- |
| Tournoi en cours (`RUNNING`) — un tournoi terminé ne se rouvre pas | `409 TOURNAMENT_NOT_RUNNING` |
| Format (ou phase **en cours** d'un multi-phases) Survie, suisse ou BG Survie | `409 FORMAT_WITHOUT_FORFEIT` |
| BG Survie : play-offs non lancés (l'arbre final est posé, l'équipe ne peut plus y entrer) | `409 ENDURANCE_PLAYOFFS_STARTED` |
| L'engagé figure au classement | `404 TEAM_NOT_IN_TOURNAMENT` |
| L'engagé est `FORFEIT` | `409 TEAM_NOT_FORFEITED` |

La transaction prend `lockTournamentRow` en toute première instruction.

## Permission : administrateur strict

`user.isAdmin === true`, et non `can(user, "tournaments")` — décision du
propriétaire du site : l'arbitrage déclare un abandon, seul un administrateur
remet en lice une équipe que les autres croyaient sortie. C'est, avec la
suppression d'un tournoi (`TOURNAMENT_DELETION.md`), la seconde exception à la
règle des permissions scopées (`docs/AUTHORIZATION_RULES.md` §1.4).

Le droit voyage dans le contexte du lecteur, `TournamentViewerContext.canCancelForfeit`,
par **les deux portes** (flux SSE et lecture REST), et `live-state.ts` le rejoue à
chaque instantané, comme `canDelete`.

## Interface

Le bouton « Annuler l'abandon » (bleu glacier, `FORFEIT_CANCEL_BUTTON_STYLE` —
pas l'ambre, réservé aux avertissements) n'apparaît que :

- sur une ligne de statut `FORFEIT` du classement ;
- pour un lecteur `canCancelForfeit` ;
- sur un tournoi `RUNNING` dont le suivi n'est pas arrêté (`canCancelForfeits`) ;
- en BG Survie, avant les play-offs.

Il ouvre une `ConfirmActionDialog` ; le succès et l'échec passent par le toast.

## Journal

`publishStaffAction(formatForfeitCancelledLog(…))` après le commit : « Abandon
annulé : <engagé> revient en lice, par le staff » sur Discord (un joueur en
tournoi individuel), auteur nommé dans pm2 seulement.

## Tests

- `tests/lib/server/forfeit-cancellation-service.test.ts` — verrou en premier,
  fenêtre, statut remis à `ACTIVE`, rejeu du bon moteur, multi-phases.
- `tests/app/api/admin/forfeit-cancellation.test.ts` — administrateur seul,
  codes d'erreur, journal anonyme.
- `tests/tournois/forfeit-eligibility.test.ts` — `canCancelForfeits`.
- `tests/lib/shared/bot-logs.test.ts` — ligne Discord.
