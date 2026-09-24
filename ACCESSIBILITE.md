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
   sont **pas** réattribués : **dernier numéro attribué — 17**.
3. **Abandonner une tâche** (ou ne la régler qu'en partie) : la remettre ici
   par un commit direct sur `main`, sous son numéro d'origine. La PR qui règle
   une tâche n'a rien à retirer de ce fichier.

---

## 9. Fiche tournoi : attributs ARIA à vérifier

- **Constat** : axe laisse `aria-required-children` et `aria-prohibited-attr`
  « à vérifier » sur `/tournois/[id]` (probablement une liste ou des onglets
  du plateau). Identifier les nœuds et corriger les rôles.

## 10. Erreurs de formulaire liées aux champs

- **Critère** : WCAG 3.3.1 / 3.3.3 · RGAA 11.10 / 11.11.
- **Constat** : la convention du projet fait passer **toutes** les erreurs par
  une notification. Une erreur de saisie doit aussi être rattachée au champ.
- **À faire** : garder la notification, et ajouter sur le champ fautif
  `aria-invalid="true"` + `aria-describedby` vers une aide existante. Décision
  de conception à valider avant de toucher aux formulaires.

## 11. Contraste par défaut de `--ink-dim`

- **Critère** : WCAG 1.4.3 · RGAA 3.2.
- **Constat** : `--ink-dim` (`#55636f`) plafonne à 3,3:1 et sert 52 fois de
  couleur de texte. Le menu le corrige **à la demande** (réglage « Contraste
  renforcé ») ; le rendu par défaut reste non conforme, par choix esthétique.
- **À décider** : relever la valeur par défaut (≈ `#7d8b98`, à vérifier sur
  `--cyber-bg-3`) ou assumer la non-conformité dans la déclaration (tâche 12).

## 12. Déclaration d'accessibilité

- **Critère** : RGAA, obligation légale selon la taille de l'organisme.
- **À faire** : décider si l'association y est tenue ; si oui, une page
  `/accessibilite` (état de conformité, contenus non accessibles, contact) et
  un lien dans le pied de page.

## 13. Passe au lecteur d'écran

- **À faire** : parcours complet avec NVDA (Windows) et VoiceOver (macOS / iOS)
  — connexion, inscription d'une équipe, report de score, menu d'accessibilité.
  Aucun test automatique ne remplace celui-là.

## 16. Titres des fiches d'équipe et de joueur

- **Critère** : WCAG 2.4.2 · RGAA 8.6.
- **Constat** : `/equipes/[id]` et `/joueurs/[id]` s'intitulent « Équipes » et
  « Joueurs », hérités de l'annuaire : deux onglets ouverts sur deux fiches
  portent le même titre.
- **À faire** : un `generateMetadata` dans une mise en page de segment, sur le
  modèle de `app/(secured)/tournois/[id]/layout.tsx` — nom de l'équipe, pseudo
  du joueur, en respectant la visibilité du profil (un compte anonymisé ou
  masqué ne doit pas nommer quelqu'un dans l'onglet).
