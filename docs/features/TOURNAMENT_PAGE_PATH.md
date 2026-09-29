# Fiche tournoi — arrivée, retour et confirmations

Quatre défauts de parcours de `/tournois/[id]`, réglés ensemble parce qu'ils
touchent tous ce qu'on voit en arrivant sur la fiche ou en la quittant.

## 1. Un flux ouvert qui ne livre rien

Le flux SSE porte la donnée : la page ne fait aucune lecture REST tant qu'il
tient, et le repli n'était armé que par `onerror`. Or un flux peut **s'ouvrir**
(200, `onopen`) sans rien livrer — un proxy ou un antivirus qui met la réponse
en tampon la garde tant qu'elle n'est pas finie, et un flux ne finit pas. Aucune
erreur ne se déclarait, `onopen` coupait même le sondage de secours : la page
restait sur « Chargement du tournoi… » **indéfiniment**.

Désormais (`useTournamentLive`), un flux ouvert sur une page encore vide arme un
guet de `FIRST_SNAPSHOT_TIMEOUT_MS` (5 s, `_lib/live-state.ts`). Passé ce délai
sans instantané :

- la donnée est lue par REST (échec définitif compris : 401/404 arrêtent le
  suivi comme d'habitude) ;
- le sondage de secours démarre, à la cadence du palier ;
- le témoin de flux quitte « À jour » — ce flux ne livre rien ;
- le flux **reste ouvert** : un premier message tardif lève le guet, coupe le
  sondage et reprend la main.

Le guet est levé par tout message, toute erreur, une reconnexion, l'échec
définitif et le démontage.

L'attente elle-même n'est plus un texte nu : `TournamentLoading` dessine la
silhouette de la page (en-tête, faits, frise, cartes), décorative
(`aria-hidden`), la phrase restant annoncée en `role="status"`. Son balayage
lumineux suit le régime de charge (`--deco-anim-state`).

## 2. « Retour » qui faisait quitter le site

`← Retour` appelait `router.back()` sans condition. Arrivé par un lien partagé
sur Discord ou par le lien profond d'un match de l'accueil (`#match-…`), on
quittait le site ou l'on revenait sur un onglet vide.

C'est maintenant un **vrai lien** vers `/tournois` (atteignable, ouvrable dans
un onglet) qui ne cède au retour dans l'historique que si la page précédente
est **connue et à nous** (`lib/shared/site-back.ts`, pur) :

- la navigation interne est relevée par `SiteNavigationTracker` (mise en page
  racine) — l'App Router ne recharge pas le document, donc
  `document.referrer` reste celui de l'arrivée ;
- à défaut, un `document.referrer` de même origine (nouvel onglet ouvert
  depuis le site, rechargement) ;
- jamais `/connexion` (y revenir rejouerait la connexion), jamais la page
  elle-même, jamais sans entrée d'historique précédente.

Le libellé dit où l'on va : « Retour » dans le premier cas, « Tous les
tournois » sinon. Un clic avec modificateur (Ctrl, ⌘, Maj, Alt) ou du bouton du
milieu est laissé au lien.

## 3. La frise sous l'en-tête

La frise de progression (`TournamentProgress`) situe le tournoi sur son cycle de
vie — ce qu'on cherche en arrivant. Elle était rendue tout en bas, sous les
inscrites et les contacts ; elle suit maintenant directement l'en-tête.

## 4. Une modale commune pour les confirmations

L'abandon d'un engagé, le retrait d'une pénalité d'endurance et le lancement
forcé d'un match passaient par `window.confirm`, quand leurs voisins (retour en
arrière, suppression, retrait d'un engagé) ont une modale. Ils passent par
`ConfirmActionDialog` : portail sur `document.body`, `useDialogBehavior`,
`useBackdropDismiss` (voir `MODAL_DIALOGS.md`), rôle `alertdialog`, **focus
initial sur « Annuler »** — un Entrée réflexe ne valide plus un geste sans
retour —, et fermeture seulement sur un geste abouti : un refus laisse la modale
ouverte. Rien ne ferme la modale pendant que le geste est en vol.

La modale se referme d'elle-même quand le suivi est arrêté (page) ou quand le
bouton qui l'a ouverte disparaît (lancement forcé, match lancé entre-temps par
un autre arbitre).

## 5. Un paquet par besoin, pas un paquet pour tous

La fiche chargeait 215 Ko de JavaScript au premier affichage (61 Ko propres à
la route) : les quatre vues de format et les treize dialogues d'arbitrage
partaient chez chaque spectateur, qui ne voit qu'un format et n'ouvre presque
jamais un dialogue. Ils passent désormais par `next/dynamic` (`ssr: false`) :

- **vues de format et panneaux du staff** (`SurvivalView`, `SwissView`,
  `EnduranceView`, `BracketPreview`, `PhaseStandingsBlock`,
  `EntrantContactsPanel`) — chargées au premier rendu qui les affiche ;
- **dialogues** — tous rendus sous condition d'ouverture, donc chargés au geste
  qui les ouvre.

Mesure `next build` : 61 → 38,2 Ko propres, **215 → 186 Ko** au premier
chargement. `BracketSections` reste dans le paquet : il sert l'élimination (le
cas le plus courant) et l'arbre de la BG Survie. Aucun rendu serveur n'est
perdu : la page n'affiche rien de ces blocs avant le premier instantané du flux.
Chaque chargement passe par `orReload` (`_lib/lazy-component.ts`) : la fiche
reste ouverte tout un tournoi, et un déploiement survenu depuis supprime les
anciens fichiers — sans filet, le 404 lèverait un `ChunkLoadError` au rendu et
Next remplacerait toute la page par son écran d'erreur. L'échec recharge donc la
page — une fois sûr (aucune modale ouverte, navigateur en ligne, lecteur resté sur la fiche), une fois par minute au plus —, le composant restant vide d'ici là.
Un composant ajouté à la fiche et réservé à un public ou à un format suit la
même règle ; `tests/tournois/page-bundle-split.test.ts` tient la liste.
