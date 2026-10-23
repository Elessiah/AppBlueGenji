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
   sont **pas** réattribués : **dernier numéro attribué — 23**.
3. **Abandonner une tâche** (ou ne la régler qu'en partie) : la remettre ici
   par un commit direct sur `main`, sous son numéro d'origine. La PR qui règle
   une tâche n'a rien à retirer de ce fichier.

---

## 13. Passe au lecteur d'écran

- **À faire** : parcours complet avec NVDA (Windows) et VoiceOver (macOS / iOS)
  — connexion, inscription d'une équipe, report de score, menu d'accessibilité.
  Aucun test automatique ne remplace celui-là.

## 22. Groupes de filtres et de tris des annuaires sans nom

- **Critère** : RGAA 11.6 / 11.7 (regroupement de champs), WCAG 1.3.1, 4.1.2.
- **Constat** : `app/(secured)/joueurs/PlayersList.tsx` (et `equipes/TeamsList.tsx`) — les pastilles de statut et les boutons de tri sont des boutons `aria-pressed` sans conteneur nommé ; « Trier : » est un `span` non rattaché. Un lecteur d'écran annonce « Date de création, bouton bascule » sans dire qu'il s'agit d'un tri ni que les options s'excluent (relevé en revue de la PR #466).
- **À faire** : envelopper chaque série dans `role="group"` avec `aria-labelledby` (« Trier : », « Statut »), ou passer en groupe de radios.

## 23. Résultat des filtres d'annuaire non annoncé, pas d'état vide

- **Critère** : RGAA 7.5 (messages de statut), WCAG 4.1.3.
- **Constat** : `app/(secured)/joueurs/PlayersList.tsx` — après un clic sur une pastille ou un filtre de rôle, le nombre de résultats change sans être annoncé (pas d'`aria-live`), et une combinaison sans résultat (« Sans équipe » + un rôle) laisse une grille vide avec « 0 joueurs » seulement (relevé en revue de la PR #466).
- **À faire** : compteur dans une région `aria-live="polite"` et message d'état vide traduit (FR et EN) ; même traitement sur `/equipes`.
