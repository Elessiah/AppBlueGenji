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
- Une **garde synchrone** (`useRef`) écarte le second envoi qui part avant que
  `busy` soit rendu (double clic, Entrée répétée) : `if (busyRef.current) return;
  busyRef.current = true;` … `finally { busyRef.current = false; }`.
- Un **champ** peut garder `disabled` quand c'est la bonne sémantique : liste
  déroulante (le focus est sur le bouton qui envoie, une liste n'envoie pas le
  formulaire), liste des maps d'un score (`MapScoreList`, Entrée n'y envoie
  pas), valeur figée durablement. Un champ texte où **Entrée** lance l'envoi
  passe en `readOnly`, pas en `disabled` (il perdrait le focus).
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
