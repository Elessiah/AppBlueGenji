# Accessibilité — tâches restantes (RGAA 4.1 / WCAG 2.2 AA)

Issu de l'audit du 2026-09-24. Déjà traité par la PR du menu d'accessibilité
(`docs/features/ACCESSIBILITY_MENU.md`) :

- notifications annoncées aux lecteurs d'écran, avec pause et fermeture ;
- bandeau défilant avec pause, copie masquée aux technologies d'assistance ;
- contraste renforcé, focus très visible, liens soulignés, police simplifiée,
  espacement du texte et réduction des animations — **en réglages activables**,
  désactivés par défaut.

Puis par la PR `feature/accessibility-quick-wins` : lien d'évitement
(ancienne tâche 1), titres des espaces connectés (2), langue des pages légales
du bot (3), page courante et pictogrammes des navigations (4), indicateur de
développement de Next (14).

Puis par la PR `feature/accessibility-landing-fixes`
(`docs/features/ACCESSIBILITY_LANDMARKS_FOCUS.md`) : focus des champs hors
`.field` (7), ordre des titres de `/connexion` et repères de `/association` (8),
en-tête et pied de page des pages vitrine hors de `<main>` (15), fermeture du
menu burger quand le focus en sort (17). La tâche 5 (modales de la vitrine)
était déjà réglée par `LandingDialog`, qui passe par `useDialogBehavior`.

Puis par la PR #183 (`docs/features/ACCESSIBILITY_RECRUITMENT_BANNER_LINK.md`) :
lien « Voir » de la bannière de recrutement (6).

Chaque tâche ci-dessous est indépendante et peut être confiée à une session
séparée. Une branche `feature/<nom>` par tâche, avec ses tests, selon le
pipeline de `CLAUDE.md`.

**Choisir ou ajouter une tâche se pousse directement sur `main`, sur-le-champ**
— jamais dans une branche de feature (voir `CLAUDE.md`, « Accessibilité ») :

1. **Choisir ses tâches** : partir de `origin/main` à jour, **retirer** la
   section de chaque tâche retenue, commiter et pousser vers `main` **avant**
   d'écrire le moindre code. Puis résoudre dans la branche de feature — une
   tâche absente d'ici est prise.
2. **Ajouter une tâche** : même chemin, à la suite, même format (critère,
   constat, à faire), avec le numéro qui suit le dernier attribué — relu sur
   `main` au moment du push et avancé dans le même commit. Les numéros ne
   sont **pas** réattribués : **dernier numéro attribué — 18**.
3. **Abandonner une tâche** (ou ne la régler qu'en partie) : la remettre ici
   par un commit direct sur `main`, sous son numéro d'origine. La PR qui règle
   une tâche n'a rien à retirer de ce fichier.

---

## 10. Erreurs de formulaire liées aux champs — formulaires restants

- **Critère** : WCAG 3.3.1 / 3.3.3 · RGAA 11.10 / 11.11.
- **Constat** : réglée en partie par `feature/accessibility-form-errors-statement`
  (`docs/features/ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`) : création d'équipe,
  équipe fantôme, identité d'une équipe, profil, connexion par code, formulaire
  de tournoi. Restent sans rattachement au champ : l'invitation d'un joueur et
  l'attribution d'une fantôme (`PlayerPseudoCombobox` — `USER_NOT_FOUND`,
  `ALREADY_INVITED` ; le refus est rendu par `useMemberManagement`, qui ne
  remonte que `true`/`false`), la saisie du tag de `DiscordVerificationDialog`,
  et les phases d'un tournoi multi-phases (`PhaseBuilder`, refus de
  `validatePhases`).
- **À faire** : même mécanique (`useFieldErrors`, `FieldErrorText`, table dans
  `lib/shared/field-errors.ts`) ; pour la liste déroulante du pseudo, ne pas
  ramener le focus sans empêcher l'ouverture des suggestions qu'il déclenche.

## 13. Passe au lecteur d'écran

- **À faire** : parcours complet avec NVDA (Windows) et VoiceOver (macOS / iOS)
  — connexion, inscription d'une équipe, report de score, menu d'accessibilité.
  Aucun test automatique ne remplace celui-là.

## 18. Zones défilantes focusables même sans rien à faire défiler

- **Critère** : WCAG 2.4.3 / 2.1.1 · RGAA 12.8 (ordre de tabulation), 12.6 (repères).
- **Constat** : `components/cyber/ScrollArea.tsx` pose toujours `tabIndex={0}`
  et, dès qu'un `ariaLabel` est fourni, `role="region"`. Quand le contenu tient
  dans la zone (grand écran), c'est un arrêt de tabulation qui ne fait rien et
  un repère de plus autour d'un contenu souvent déjà nommé — ex. le classement
  de la ronde suisse (`SwissView.tsx`), « Classement du tournoi — défilement
  horizontal » autour du tableau « Classement du tournoi », ou les rondes du
  même écran.
- **À faire** : ne rendre la zone focusable (et n'en faire une région) que
  lorsqu'elle déborde réellement (`scrollWidth > clientWidth`, relu par un
  `ResizeObserver`), en gardant le rendu serveur sûr (focusable par défaut ou
  non — à trancher) ; vérifier chaque appelant qui compte sur le `role`.
