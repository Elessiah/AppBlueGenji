# Boutons occupés — `aria-disabled` + `aria-busy`

Pendant une requête, un bouton **ne passe jamais en `disabled` natif** : le
navigateur lui retirerait le focus clavier (il tomberait sur le `<body>`,
derrière la modale) et un lecteur d'écran perdrait sa place, sans rien
annoncer de l'attente.

## Règle

- Le bouton porte `aria-disabled={busy || <autres refus> || undefined}` et
  `aria-busy={busy || undefined}` : il reste focalisable, se lit « indisponible,
  occupé ».
- Le **gestionnaire** fait la garde (`if (busy) return`) : `aria-disabled`
  n'empêche ni le clic ni la soumission. Un bouton `submit` garde donc **toutes**
  ses raisons de refus dans le `onSubmit` (Entrée dans un champ le déclenche).
- Une **garde synchrone** écarte le second envoi qui part avant que `busy` soit
  rendu (double clic, Entrée répétée) : `useBusyGuard()`
  (`lib/shared/hooks/useBusyGuard.ts`) rend `busy` (affichage), `isBusy()`
  (garde des gestionnaires, juste avant le rendu) et `run(task)`, qui lève le
  drapeau **avant** la première attente et le baisse dans `finally` sur tout
  chemin (refus, exception) — logique pure `runExclusive`
  (`lib/shared/busy-guard.ts`). Jamais de drapeau écrit à la main. Deux gestes
  d'une même fenêtre (enregistrer, ouvrir l'antenne) partagent **un** `run`
  (`useOnAirToggle` le reçoit).
- Un **champ** peut garder `disabled` quand c'est la bonne sémantique : liste
  déroulante (le focus est sur le bouton qui envoie, une liste n'envoie pas le
  formulaire), liste des maps d'un score (`MapScoreList`, Entrée n'y envoie
  pas), valeur figée durablement (`locked`). Un champ où **Entrée** lance
  l'envoi passe en `readOnly`, pas en `disabled` (il perdrait le focus) : saisie
  de la première map, lien de rediff, points par map (`RoundMapsDialog`).
- Le **libellé reste** pendant l'attente (suivi de « … ») : un bouton focalisé
  dont le nom se réduit à « … » ne dit plus rien.
- Apparence : `.btn:where([aria-disabled="true"][aria-busy="true"])` donne le
  curseur d'attente (`globals.css`) ; un état désarmé se dit en **couleurs**,
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
- Reste à convertir : voir l'entrée « boutons grisés restants » d'`ERREUR.txt`.
