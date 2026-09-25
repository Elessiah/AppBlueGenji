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
   sont **pas** réattribués : **dernier numéro attribué — 19**.
3. **Abandonner une tâche** (ou ne la régler qu'en partie) : la remettre ici
   par un commit direct sur `main`, sous son numéro d'origine. La PR qui règle
   une tâche n'a rien à retirer de ce fichier.

---

## 13. Passe au lecteur d'écran

- **À faire** : parcours complet avec NVDA (Windows) et VoiceOver (macOS / iOS)
  — connexion, inscription d'une équipe, report de score, menu d'accessibilité.
  Aucun test automatique ne remplace celui-là.

## 19. Infobulle du vainqueur inatteignable sous la plaque de la carte tournoi

- **Critère** : proche de RGAA 10.7 / WCAG 1.1.1 — une information (le nom
  complet, tronqué en ellipse dans le rendu) devient indisponible autrement
  qu'au survol précis d'un pixel qu'aucun pointeur n'atteint plus.
- **Constat** : `app/(secured)/tournois/cards/FinishedCard.tsx`, `.cardChampion`
  — le nom complet d'un vainqueur tronqué se lisait au survol via
  `title={t.champion?.name}`. Depuis que le lien de la carte est devenu une
  plaque transparente posée par-dessus tout le reste (`.cardOverlay`,
  `z-index: 1` — voir `docs/features/TOURNAMENT_LIST_CARDS.md`), la souris
  n'atteint plus `.cardChampion` : l'infobulle native ne se déclenche plus.
  Même limite déjà présente sur `TeamCard.tsx` (le `title` du bloc de points
  de classement, sous le même patron `.cardOverlay`).
- **À faire** : remplacer le `title` natif par une bulle déclenchée par
  `.card:hover`/`.card:focus-within` (comme `.card:hover .cardCta` dans
  `tournois.module.css`), ou porter le nom complet en `aria-label` du lien de
  recouvrement en plus du titre visible tronqué — vérifier alors `TeamCard.tsx`
  en même temps, qui porte la même limite.
