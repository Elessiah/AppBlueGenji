# Régime de charge du navigateur (modes complet / éco / match / veille)

Un joueur de BlueGenji a très souvent le site ouvert **pendant qu'il joue** —
sur un second écran, ou derrière Overwatch / Marvel Rivals en plein écran — pour
voir son prochain adversaire et rapporter son score. Tout ce que la page peint
pendant ce temps est pris au jeu : processeur, carte graphique, mémoire.

Le site règle donc ce qu'il a le droit de coûter selon ce que fait
l'utilisateur. Règle écrite une fois, dans `lib/shared/client-power.ts` (pur).

## Les quatre régimes

| Régime | Quand | Animations décoratives | Fond animé | Rendu d'un instantané reçu | Flux SSE |
|---|---|---|---|---|---|
| `FULL` | page regardée, pas de match, machine à l'aise | oui | animé (30 i/s max) | immédiat | palier normal |
| `ECO` | page **sans focus** (second écran), **ou** machine à la peine, **ou** mouvement réduit demandé (par le système, ou par « Réduire les animations » du menu d'accessibilité — `motionSetting`, qui n'affiche pas le témoin : le menu le dit déjà) | figées | image fixe | immédiat | palier normal |
| `MATCH` | le lecteur a une rencontre en cours (de « prête » au résultat) | figées | **mémoire rendue** | immédiat si la page a le focus ; sinon regroupé toutes les 5 s, **sauf son propre match** | palier normal |
| `SLEEP` | onglet caché | figées | mémoire rendue | **au retour** seulement | palier spectateur après 60 s, hors match |

Ce qui ne s'arrête **jamais** : le flux SSE **du tournoi**, et la détection des
évènements qui concernent le lecteur. Couper ce flux ferait manquer l'annonce
qu'on attend. (Le flux de `/bot`, lui, se ferme onglet caché : il n'annonce rien
à personne.)

## Annonces quand on ne regarde pas (`lib/shared/viewer-alerts.ts`)

Chaque instantané **reçu** — rendu ou non — est comparé au précédent :

1. `SCORE_TO_CONFIRM` — un match du lecteur attend sa confirmation ;
2. `MATCH_READY` — un match du lecteur devient jouable (adversaire connu) ;
3. `TOURNAMENT_STARTED` — le tournoi est lancé ;
4. `ROUND_STARTED` — une nouvelle manche s'ouvre (clé phase + tableau + manche).

Un seul par instantané, le plus précis. Les deux premiers font **sonner** (deux
notes distinctes, `_lib/sounds.ts`, contexte audio refermé après la note — il en
fuyait un par signal) ; tous posent un **titre d'onglet** « ● Ton match est
prêt · … » tant que la page n'a pas le focus (`_lib/attention.ts`), sans
clignotement — un clignotement, c'est un minuteur par seconde.

## Le match du lecteur

`viewerMatchFocus` : tournoi `RUNNING`, rencontre `READY` ou
`AWAITING_CONFIRMATION` à deux engagées, dont celle du lecteur, et horaire
absent ou à moins de dix minutes (`MATCH_FOCUS_LEAD_MS`). Calculé sur l'état
**reçu** (le rendu peut retarder), avec un unique `setTimeout` sur l'approche du
prochain horaire.

L'onglet du tournoi le déclare aux **autres onglets du site** par un bail
`localStorage` (`bg_match_focus`, identifiant d'onglet → échéance), renouvelé
toutes les dix minutes, rendu au démontage et à `pagehide`, et qui expire seul
en vingt minutes si l'onglet meurt sans le rendre. Les autres onglets le lisent
par l'évènement `storage` : l'accueil ouvert à côté se calme aussi.

## Performances limitées → éco

Trois signaux (`performanceLimits`) :

- **processeur** : `navigator.hardwareConcurrency` ≤ 2 (voir la réserve plus bas) ;
- **mémoire** : `navigator.deviceMemory` ≤ 2 Go (Chromium seulement) ;
- **cadence mesurée** : médiane de 90 intervalles `requestAnimationFrame`, trois
  secondes après l'arrivée puis toutes les cinq minutes, **page au focus
  seulement**. Au-delà de 28 ms (sous ~36 i/s) → ralenti. C'est le seul signal
  qui attrape le bridage **imposé** — économiseur de batterie à 30 i/s, mode
  « efficacité », jeu qui accapare la carte graphique —, qu'aucune API ne dit.
  Un ralenti constaté **tient jusqu'au rechargement** : remesuré en éco,
  animations coupées, il disparaîtrait, et une machine lente *à cause* des
  animations du site oscillerait d'un régime à l'autre toutes les cinq minutes.
- le nombre de cœurs n'est cru que si le navigateur déclare **aussi** sa
  mémoire : Firefox en mode anti-empreinte et Tor Browser annoncent un nombre
  de cœurs maquillé (deux, selon les versions).

Le lecteur peut **ignorer la détection** depuis le témoin
(`bg_power_ignore_perf`). Match, focus et onglet caché ne s'ignorent pas : ce
sont des faits, pas des estimations.

## Témoin (`components/client-power-badge.tsx`)

Pastille en bas à droite, sous les boutons flottants — **centrée en bas sous
720 px**, là où le bouton « ? » descend dans le coin (même point de rupture que
lui, sans quoi elle le recouvrirait). Son panneau passe devant les boutons
flottants (`z-index` 110 contre 100). Elle n'apparaît que pour
un régime qui **tient page regardée** — match, machine à la peine, mouvement
réduit —, jamais pour la seule absence de focus : la cliquer rendrait le focus,
donc le régime complet, et elle disparaîtrait sous le pointeur. Un clic ouvre le
détail : ce que le régime retire, les raisons (dont la cadence mesurée), le
matériel déclaré, et la case « Ignorer la détection de performances ». Quand
cette case est cochée sur une limite constatée, la page repasse en régime
complet mais le témoin **reste** (« Mode complet », avec ce qui a été constaté) :
c'est lui qui porte la case qui défait ce choix.

Pour un diagnostic à distance, `<html data-power="full|eco|match|sleep">` et
`data-motion="on|off"` se lisent dans l'inspecteur.

## Mécanique

- **Magasin unique** (`lib/shared/hooks/useClientPower.ts`) : un seul jeu
  d'écouteurs (visibilité, focus, `storage`, mouvement réduit) pour toute la
  page, via `useSyncExternalStore`. `useClientPower()` rend la politique,
  `useClientPowerState()` tout l'état (témoin). Une **page entière** ne s'y
  abonne pas par un hook — elle serait re-rendue à chaque alt-tab — mais par
  `subscribeClientPower` / `getClientPowerInput`, lus dans des refs (c'est ce
  que fait `useTournamentLive`).
- **Animations CSS** : toute animation **infinie** lit
  `animation-play-state: var(--deco-anim-state)`, jeton que `ClientPowerRoot`
  passe à `paused` sous `html[data-motion="off"]` (et la préférence système de
  mouvement réduit dès le premier rendu). `tests/app/deco-animations.test.ts`
  balaie toutes les feuilles et les styles en ligne : une animation infinie
  ajoutée sans la ligne fait échouer les tests.
- **Fond `BgCanvas`** : le mode `radial` est un dégradé CSS (il était redessiné
  à chaque image, pour toujours) ; le mode `network` est plafonné à 30 i/s,
  figé en éco, et son tampon de pixels est rendu (`canvas.width = 0`) en match
  et en veille.
- **`LogoWithGlow`** : la boucle d'inclinaison ne tourne que pendant qu'elle
  rattrape le pointeur (elle tournait à la fréquence de l'écran, souris
  immobile), et plus du tout hors régime complet.
- **Horloges** (`useClock`) : comptes à rebours arrêtés onglet caché, recalés
  au retour.
- **Flux du bot** (`/bot`) : fermé après une minute d'onglet caché ; au retour,
  la liste repart de l'historique que le bot rejoue à chaque connexion.
- **Flux du tournoi** (`useTournamentLive`) : l'état *reçu* (`stateRef`) et
  l'état *rendu* sont séparés ; le rendu suit la politique. Onglet caché
  soixante secondes hors match → reconnexion en `?quiet=1`, au retour
  reconnexion normale.

## Serveur : `?quiet=1`

`GET /api/tournaments/[id]/stream?quiet=1` sert le palier `STANDARD` quel que
soit le lecteur. Le paramètre **ne sait que déclasser** : aucune valeur ne
promeut un spectateur. Un engagé dont l'onglet dort libère ainsi le budget de
sortie de la salle (`ROOM_BYTES_PER_SECOND`) pour ceux qui jouent, et reçoit
encore l'annonce de son match, à la fenêtre des spectateurs : vingt secondes
d'ordinaire, jusqu'à une minute quand le budget de sortie d'une grosse salle
l'élargit (`MAX_BUDGET_DELAY_MS`, qui vaut pour tous les paliers).
