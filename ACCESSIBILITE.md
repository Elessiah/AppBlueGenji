# Accessibilité — tâches restantes (RGAA 4.1.2 / WCAG 2.1 AA, plus quelques critères WCAG 2.2)

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
   sont **pas** réattribués : **dernier numéro attribué — 21**.
3. **Abandonner une tâche** (ou ne la régler qu'en partie) : la remettre ici
   par un commit direct sur `main`, sous son numéro d'origine. La PR qui règle
   une tâche n'a rien à retirer de ce fichier.

---

## 13. Passe au lecteur d'écran

- **À faire** : parcours complet avec NVDA (Windows) et VoiceOver (macOS / iOS)
  — connexion, inscription d'une équipe, report de score, menu d'accessibilité.
  Aucun test automatique ne remplace celui-là.

## 21. Onglet d'accessibilité sur la colonne des pages vitrine

- **Critère** : WCAG 2.4.11 (focus non masqué) · RGAA 10 (contenu masqué par
  un élément fixe).
- **Constat** : au-delà de 720 px, le bouton d'accessibilité est un onglet de
  28 px collé au bord gauche, à mi-hauteur
  (`components/accessibility/AccessibilityMenu.module.css`). L'espace connecté
  lui réserve une gouttière de 32 px (`.page-shell`, `app/globals.css`), mais
  les pages vitrine gardent des colonnes en `min(1240px, calc(100vw - 40px))`
  (accueil, association, pied de page public…) : entre 721 et ~1300 px de
  large, l'onglet mord de 8 à 16 px le bord gauche de la colonne quand un
  contenu passe à mi-hauteur.
- **À faire** : réserver la même gouttière aux colonnes vitrine (un jeton
  partagé plutôt que quatorze `calc` à tenir), puis vérifier qu'aucun
  contrôle focalisable ne passe sous l'onglet.
