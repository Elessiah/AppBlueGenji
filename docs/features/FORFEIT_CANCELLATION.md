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
`reconcileSwiss`, `reconcileEndurance`). En multi-phases, seul `reconcilePhases`
est appelé : il rejoue le moteur de la phase avec la cible de qualifiées
qu'il est seul à connaître (un appel direct couperait jusqu'à une équipe).

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
manche en cours, elle n'a pas de match. Le rejeu pouvant l'éliminer aussitôt, le
message de succès dit seulement que le classement est recalculé.

## Fenêtre

| Condition | Refus |
| --- | --- |
| Tournoi en cours (`RUNNING`) — un tournoi terminé ne se rouvre pas | `409 TOURNAMENT_NOT_RUNNING` |
| Format (ou phase **en cours** d'un multi-phases) Survie, suisse ou BG Survie | `409 FORMAT_WITHOUT_FORFEIT` |
| BG Survie : play-offs non lancés (l'arbre final est posé, l'équipe ne peut plus y entrer) | `409 ENDURANCE_PLAYOFFS_STARTED` |
| L'engagé figure au classement | `404 TEAM_NOT_IN_TOURNAMENT` |
| L'engagé est `FORFEIT` | `409 TEAM_NOT_FORFEITED` |
| Aucune manche **postérieure** à celle de l'abandon ne porte de saisie (même borne que le retrait d'une pénalité) — sinon l'équipe rentrerait sans que les manches manquées comptent contre elle | `409 FORFEIT_ROUND_PASSED` |

### Concurrence

La transaction lit la ligne du tournoi `FOR UPDATE` en toute première
instruction : ce verrou est la lecture de sa tête (colonnes utiles), une seule
requête au lieu de `lockTournamentRow` suivi d'une relecture. Elle
verrouille donc le tournoi avant les manches que le rejeu peut poser, quand un
report ou une correction d'arbitrage prend son match avant le tournoi
(« Enregistrer » prend le tournoi d'abord, en toute première instruction de sa
transaction : face à l'annulation, une simple attente) : comme l'abandon,
elle passe par `retryOnDeadlock`, qui rejoue la transaction entière après un
interblocage (publication une seule fois, après le commit réussi).

**Aucune lecture d'instantané avant celle des manches.** Sous MariaDB 11.8
(`innodb_snapshot_isolation`), une lecture verrouillante d'une ligne changée
depuis l'image de la transaction est refusée (`ER_CHECKREAD`) ; une première
lecture ordinaire figeait cette image avant l'attente du verrou des manches, et
une rafale de « Prêt » à l'ouverture du salon épuisait les rejeux. Tête du
tournoi, phase en cours (`FOR UPDATE` : le rejeu des phases peut la réécrire,
un verrou partagé à promouvoir attendrait tout autre lecteur), ligne du classement (clé
primaire) et manches postérieures se lisent donc toutes sous verrou ; l'image ne
naît qu'après (rejeu du classement). Le nom de l'équipe, pour le journal, se lit
**avant** la transaction, en lecture autonome : ni image ouverte, ni verrou
partagé tenu pendant le rejeu (un renommage de l'équipe l'attendait). Son
classement verrouillé la garde : l'effacer le supprime en cascade, et attend
donc ce verrou.

Les manches postérieures se lisent par `laterRoundsHaveScoreInput`
(`lib/server/tournaments/bg-survie/round-progress.ts`, la règle commune au
retrait d'une pénalité, qui la lit verrouillée lui aussi — sa sanction lue
`FOR UPDATE` d'abord, aucune lecture d'image avant —, et à la correction
d'arbitrage, qui la lit en image : sa lecture ordinaire du match l'a déjà
figée, et ses autres dépendants — liens de bracket, phases — se lisent de même ;
limite consignée dans `ERREUR.txt`), **verrouillées** par
l'index `idx_bg_matches_phase_round` : les seules manches postérieures, pas
toute la phase ni ses intervalles. Un report en cours écrit son score sous le
verrou du match avant d'attendre le tournoi, et une lecture d'instantané
l'aurait manqué — l'équipe rentrait et le rejeu suisse réappariait une manche
déjà saisie. Ce report et l'annulation s'interbloquent, et le moteur choisit la
victime :

- le plus souvent l'annulation, qui n'a encore rien écrit : elle se rejoue
  (`retryOnDeadlock`), voit le score et refuse en `FORFEIT_ROUND_PASSED` ;
- si c'est le report, l'annulation passe (aucune saisie commitée ne la
  bloque) et le report, rejoué par l'équipe (`retryOnDeadlock`), s'écrit sur la
  manche telle que le rejeu du classement l'a laissée — réappariée si elle
  était vierge, auquel cas son match a pu disparaître (`MATCH_NOT_FOUND`).

Un détenteur qui ne demande jamais le tournoi (programmation, rappels,
« Prêt ») ne forme pas d'interblocage : l'annulation l'attend au plus
`SHORT_LOCK_WAIT_SECONDS` (5 s, `SET SESSION innodb_lock_wait_timeout`, remis
au défaut du serveur avant de rendre la connexion au pool —
`lib/server/tournaments/lock-wait.ts`, partagé avec le retrait d'une pénalité,
qui tient lui aussi le tournoi en verrouillant les manches) au lieu des 50 s du
serveur, en tenant le verrou du tournoi. La borne n'entoure **que** cette
lecture des manches (`withShortLockWait`, toute lecture `lock`) : le verrou du
tournoi (la tête lue `FOR UPDATE`, en toute première instruction) s'attend sans
borne comme pour tout geste — son détenteur, réconciliation ou lancement, le
rend sans rien attendre de l'annulation —, et le rejeu qui suit retrouve le
délai du serveur (journal du bot et alertes, qui tolèrent un délai dépassé,
perdraient sinon leur ligne en silence). Au retour au pool, le délai n'est
remis qu'une fois de plus si cette remise a manqué (aucune requête sinon) ; une
remise ratée après une lecture réussie arrête le geste plutôt que de rejouer sous
le délai court. Un classement dont l'équipe n'existe plus rend
`TEAM_NOT_IN_TOURNAMENT`, avant la lecture bornée des manches. Une contention qui dure —
interblocage sur les trois tentatives, `ER_CHECKREAD`, délai de verrou
(`ER_LOCK_WAIT_TIMEOUT`) — rend `409 CONCURRENT_UPDATE_RETRY` (code fixe, le
journal cite le tournoi et l'engagé), pas une panne. La route la reconnaît par
`isContentionError` (`lib/server/mysql-errors.ts`), sur le code de l'erreur
d'abord, indépendant de la langue des messages du serveur. Les verrous durent
jusqu'au commit, si bien qu'un « Prêt » de la manche suivante attend la fin du
rejeu.

**Publication** (`publishStandingsReplayedEvent`, `notifications.ts`, règle
partagée avec le retrait d'une pénalité d'endurance) : instantané, direct de
l'accueil, aperçu, listes et mini-arbres de l'accueil — le rejeu peut réécrire des
colonnes de `bg_tournaments` (manche d'endurance courante, phase) et reposer
les matchs d'une manche périmée. Aucun résultat de match ne change : le
classement du site, les statistiques et, à l'accueil, leaderboards, bandeau et
compteurs restent en cache (`publishUpdatedEvent` les vidait). L'administrateur relit le tournoi
aussitôt (`refresh()`), flux ouvert ou non : la diffusion peut attendre jusqu'à une
minute (tranche, budget de la salle), son bouton resterait périmé.

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

**Hors fenêtre** (une manche postérieure à l'abandon porte une saisie), la
ligne montre un verrou 🔒 « Figé » à la place du bouton, suivi d'une **forme
courte** lue avec la ligne (texte masqué, `forfeitCancel.frozenShort` :
« (manche jouée depuis) ») ; le motif complet vit derrière le « i » d'une
légende sous le classement (`FrozenForfeitLegend`, une fois pour toutes les
lignes — un `title` ne s'affichait ni au toucher ni au clavier, un « i » par
ligne déformait les cellules étroites, et le motif entier relu à chaque ligne
allongeait la lecture au lecteur d'écran). Le journal des sanctions de BG
Survie fait de même pour une sanction figée (`penaltyLift.frozenShort`, légende
`endurance-penalty-frozen`). La présence d'une ligne figée se teste par un
prédicat léger (`isFrozen` / `isFrozenRow`, partagé avec le geste de la ligne),
sans reformater les textes de chaque ligne à chaque rendu. La fenêtre est
calculée au serveur par `loadCancellableForfeitIds`
(`lib/server/tournaments/forfeit-window.ts`, même borne que
`FORFEIT_ROUND_PASSED`) et publiée dans `cancellableForfeitTeamIds` des métas
suisse, survie et BG Survie ; hors `RUNNING` (et, en BG Survie, une fois les
play-offs lancés) elle rend `[]` sans requête — l'interface n'y propose aucune
annulation —, et en BG Survie la borne déjà lue pour les pénalités
(`lastRoundWithScoreInput`) est réutilisée : une seule lecture.

Il ouvre une `ConfirmActionDialog` au ton primaire, dont la confirmation
« Effacer l'abandon » se distingue du « Annuler » qui ferme ; le succès et
l'échec passent par le toast, au singulier d'un joueur en tournoi individuel
(`forfeitCancel.success.SOLO`, `tournamentErrors.soloCodes`). Abandon comme
annulation sont rendus par un même `<button>` (`ForfeitRowAction`) : après le
geste, le focus revient sur le nouveau bouton de la ligne, ou sur la ligne
(`data-row-focus`) si elle n'en porte plus. `focusRowAfterChange` veille
`FOCUS_WATCH_MS` (3 s) : le rendu groupé du flux peut déplacer la ligne après
la fin de `refresh()`, et la veille s'arrête dès que le lecteur va ailleurs ou
agit (`pointerdown`, `keydown` : un clic sur du texte juste après l'abandon ne
lui reprend pas le focus). Hors régime `FULL` (`useClientPower()`), elle se
vérifie toutes les `FOCUS_WATCH_RELAXED_MS` (250 ms) plutôt qu'à chaque trame.
La ligne n'est focalisable par script (`tabindex="-1"`) qu'au moment où le focus
lui est rendu, puis ce réglage est retiré au départ du focus : un clic ou un
toucher sur le texte d'une ligne n'y pose jamais le focus.
La confirmation ne promet l'appariement qu'avec sa réserve (« sauf si les
matchs qu'elle a joués l'éliminent ») : le rejeu peut sortir l'engagé aussitôt.

Son nom accessible commence par son texte visible, dans les deux langues
(« Annuler l'abandon de X », « Cancel withdrawal of X » — WCAG 2.5.3). En ronde
suisse, une ligne forfait s'estompe **cellule par cellule**, jamais la cellule
d'action, à 90 % d'opacité (une ligne éliminée de la Survie, sans bouton,
s'estompe en entier au même taux) : une
ligne entière estompée ferait paraître le bouton désactivé, et à 55 % le texte
discret tombait vers 3:1 ; à 90 %, le chiffre de défaite rouge reste ≥ 4,5:1
même sur la ligne du lecteur (`forfeit-buttons-label-in-name.test.ts` le calcule). L'infobulle du bouton dit seulement que le
classement est recalculé, sans promettre le retour en lice.

## Journal

`publishStaffAction(formatForfeitCancelledLog(…))` après le commit : « Abandon
annulé : <engagé> revient en lice, par le staff » sur Discord (un joueur en
tournoi individuel), auteur nommé dans pm2 seulement.

## Tests

- `tests/lib/server/forfeit-cancellation-service.test.ts` — verrou en premier,
  fenêtre, statut remis à `ACTIVE`, rejeu du bon moteur, multi-phases,
  rejeu après interblocage (un refus métier ne se rejoue pas), lectures toutes
  verrouillantes avant les manches, manches postérieures verrouillées
  (interblocage → rejeu puis refus), délai de verrou court remis au défaut,
  publication sans le classement du site, contention persistante rendue en `409`.
- `tests/app/api/admin/forfeit-cancellation.test.ts` — administrateur seul,
  codes d'erreur, journal anonyme.
- `tests/tournois/forfeit-eligibility.test.ts` — `canCancelForfeits`.
- `tests/tournois/forfeit-cancel-window.test.ts` — fenêtre affichée
  (`loadCancellableForfeitIds`), refus au singulier d'un joueur (FR, EN).
- `tests/lib/shared/bot-logs.test.ts` — ligne Discord.
- `tests/tournois/forfeit-buttons-label-in-name.test.ts` — nom accessible des
  boutons d'abandon (FR, EN), réserve de la confirmation.
- `tests/tournois/swiss-standings-table.test.tsx` — estompage hors cellule
  d'action.
