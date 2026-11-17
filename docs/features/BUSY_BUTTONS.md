# Boutons occupés — `aria-disabled` + `aria-busy`

Pendant une requête, un bouton **ne passe jamais en `disabled` natif** : le
navigateur lui retirerait le focus clavier (il tomberait sur le `<body>`,
derrière la modale) et un lecteur d'écran perdrait sa place, sans rien
annoncer de l'attente.

## Règle

- Le bouton est un `<BusyButton busy={busy} blocked={<autres refus>}>`
  (`components/ui/busy-button.tsx`), jamais un `<button>` qui écrit
  `aria-disabled` / `aria-busy` à la main : il reste focalisable, se lit
  « indisponible, occupé », et **le même état** pose `aria-disabled` et annule
  l'activation (`preventDefault` sur le clic) — une raison de refus ne peut plus
  être affichée sans être appliquée. Le clic annulé d'un `submit` annule aussi
  la soumission implicite (Entrée dans un champ passe par ce clic). Un bouton
  désarmé qui **explique** son refus (« Prendre le cast » sans identité de
  caster : un toast) passe `onBlockedClick`, jamais appelé pendant un envoi.
- Le `onSubmit` garde quand même **toutes** ses raisons de refus (défense en
  profondeur) ; ce n'est que de l'ergonomie : le serveur autorise chaque geste.
- Une **garde synchrone** écarte le second envoi qui part avant que `busy` soit
  rendu (double clic, Entrée répétée) : `useBusyGuard()`
  (`lib/shared/hooks/useBusyGuard.ts`) rend `busy` (affichage), `isBusy()`
  (garde des gestionnaires, juste avant le rendu) et `run(task)`, qui lève le
  drapeau **avant** la première attente et le baisse dans `finally` sur tout
  chemin (refus, exception) — logique pure `runExclusive`
  (`lib/shared/busy-guard.ts`). Jamais de drapeau écrit à la main. Deux gestes
  d'une même fenêtre (enregistrer, ouvrir l'antenne) partagent **un** `run`
  (`useOnAirToggle` le reçoit).
  Coût de rendu : le résultat du hook est **mémoïsé** (il ne change qu'à
  l'entrée et à la sortie d'un envoi, pas à la frappe), `isBusy`/`run` sont
  stables ; démonté pendant un envoi (la tâche ferme souvent sa propre
  fenêtre), l'écran ne reçoit plus de mise à jour d'état — la requête, elle,
  va à son terme ; `isMounted()` dit si l'écran l'est encore (une relecture
  promise ne repart pas pour un panneau fermé). Un gestionnaire interroge
  `isBusy()`, jamais `busy` (fermer, ajouter ou retirer une ligne, cocher :
  un geste parti dans la même image qu'un envoi changerait l'écran sous la
  requête) ; un sous-composant qui ne reçoit que `busy` reçoit aussi `isBusy`,
  ou son appelant garde le rappel. Pas de `if (isBusy()) return` juste avant
  `run(…)`, qui fait déjà ce contrôle — seulement quand du code (validation,
  focus) passe avant.
- Un **champ** peut garder `disabled` quand c'est la bonne sémantique : liste
  déroulante (le focus est sur le bouton qui envoie, une liste n'envoie pas le
  formulaire), liste des maps d'un score (`MapScoreList`, Entrée n'y envoie
  pas), valeur figée durablement (`locked`). Un champ où **Entrée** lance
  l'envoi passe en `readOnly`, pas en `disabled` (il perdrait le focus) : saisie
  de la première map, lien de rediff, points par map (`RoundMapsDialog`).
- Le **libellé reste** pendant l'attente (suivi de « … ») : un bouton focalisé
  dont le nom se réduit à « … » ne dit plus rien. Un libellé qui **change**
  (« Enregistrer » → « Enregistrement… ») passe par `<BusyLabel>`
  (`components/ui/busy-label.tsx`) : seul le libellé actif est dans le DOM (nom
  du bouton et `textContent`, avec ou sans CSS) ; l'autre réserve sa largeur en
  pseudo-élément invisible (`::after`, `content: attr(data-alt)`) dans la même
  case de grille — le bouton ne change pas de largeur et ne pousse pas ses
  voisins à 375 px (classe `.busy-label` dans `globals.css`, aucun `style` en
  ligne : le composant se rend à chaque frappe). Aucun « … » ajouté à la main.
- Un **champ** où l'on peut encore écrire (message de signalement, liens du
  direct et du cast, BattleTag, points du tour, map de départage) passe en
  `readOnly` pendant l'envoi : ce qui est affiché est ce qui part — sinon un
  refus serait rattaché à une valeur qui n'est jamais partie, ou la réponse
  écraserait la saisie. Une case ou un bouton radio (sans `readOnly`) garde le
  focus : `aria-readonly` (case) ou `aria-disabled` (radio), et son `onChange`
  ignore le geste.
- Apparence : `.btn:where([aria-disabled="true"][aria-busy="true"])` donne le
  curseur d'attente et un liseré **en tirets** (`globals.css`, lisible sans
  curseur, au toucher) ; un état désarmé se dit en **couleurs**,
  jamais en `opacity` (`CHECKBOX_STYLES.md`), et l'attente garde son libellé lisible.

## Écrans convertis

- Écrans d'équipe — `tests/app/team-busy-buttons.test.ts`.
- Dialogues de match et d'arbitrage du tournoi (EF-66) : `RefereeDialog`,
  `MatchScheduleDialog`, `AdminScoreDialog` (+ garde de `useScoreForm`),
  `CastSettingsDialog` / `MatchLiveDialog` (+ garde de `useOnAirToggle`),
  `MatchReplayDialog`, `IssueReportDialog`, `PlayerScoreDialog`,
  `RoundMapsDialog`, `MatchPlanningPanel`, `MatchCardActions`,
  `EntrantContactsPanel` (pendant une relance, l'échec et « Réessayer » restent
  affichés : `contactsPanelView` place l'échec avant le chargement) —
  `tests/app/match-busy-buttons.test.ts`.
- Gestion du tournoi (EF-67) : `GhostRegistrationDialog`, `RegistrationsPanel`
  (flèches et « Retirer » ; arrivée en bout de liste, le focus passe à la
  flèche opposée), `RollbackRoundDialog`, `DeleteTournamentDialog`,
  `TournamentImageDialog` (+ `TournamentImagePicker`, prop `busy`),
  `TournamentDialogShell` (+ `AdvanceTournamentDialog`, `RemoveEntrantDialog`,
  qui lui passent `isBusy` et `pendingLabel`), `TournamentLiveLink`,
  `EndurancePenaltyDialog`, `TournamentForm`, `MatchLaunchCenter` —
  `tests/app/tournament-admin-busy-buttons.test.ts`. `BusyButton` transmet sa
  `ref` (`forwardRef`, React 18).
- **Geste qui quitte l'écran** sans le démonter sur-le-champ (suppression d'un
  tournoi puis `router.replace`, création ou édition puis `router.push`) :
  `useBusyGuard().hold()`, appelé au succès, garde `busy` et `isBusy()` vrais
  jusqu'au démontage — sinon `busy` retombait et un second clic recréait le
  tournoi ou relançait la suppression. Inutile quand le parent ferme le
  dialogue dans le même rendu (manche effacée).
- Formulaire de tournoi : toute saisie est ignorée pendant l'envoi (setters
  gardés par `isBusy()`, états voisins compris : suivi des rondes suisses,
  valeur retenue du format), les champs texte et dates passent en `readOnly`,
  et **tous** les `NumberInput`, sous-formulaires compris, par
  `NumberInputReadOnlyContext` — un champ numérique garde son brouillon, qui
  sinon resterait affiché sans partir ; les listes déroulantes gardent
  seulement leur `disabled` de verrou durable (`locked(…)`).
- Image d'un tournoi : le choix (Remplacer, Retirer, cadrage) passe par la
  garde synchrone du dialogue (`editDraft`), pas seulement par le `busy` rendu.
- Cases et radios figées par `aria-disabled` / `aria-readonly` : rendues
  éteintes par `globals.css` (mêmes couleurs que `:disabled`, sans survol).
- Centre de lancement : en échec, le focus revient au bouton pressé
  (« Confirmer prêt », `confirmReadyRef`), resté focalisable.
- Reste à convertir : voir l'entrée « boutons grisés restants » d'`ERREUR.txt`.
