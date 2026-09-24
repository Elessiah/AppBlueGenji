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

Puis par la PR `feature/deploy-accessibility-features` : modales de la vitrine
(5 — déjà passées par `LandingDialog` et `useDialogBehavior`, la tâche était
restée ouverte), lien « Voir » de la bannière de recrutement (6), focus des
champs hors `.field` (7, recherche de l'annuaire comprise), ordre des titres de
`/connexion` et repères de `/association` (8), menu burger fermé quand le focus
en sort (17).

Chaque tâche ci-dessous est indépendante et peut être confiée à une session
séparée. Une branche `feature/<nom>` par tâche, avec ses tests, selon le
pipeline de `CLAUDE.md`. Retirer la tâche de ce fichier dans la PR qui la règle.
Les numéros ne sont **pas** réattribués : d'autres sessions peuvent travailler
sur une tâche en parallèle et la désigner par son numéro.

**Tout problème d'accessibilité repéré en cours de développement et non réglé
dans la PR en cours s'ajoute ici**, à la suite, avec le numéro suivant et le
même format (critère, constat, à faire) — voir `CLAUDE.md`, « Accessibilité ».
Le numéro suivant est celui qui suit le **plus grand jamais attribué**, tâches
retirées comprises : **dernier numéro attribué — 17**, à avancer avec chaque
ajout.

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

## 15. En-tête et pied de page des pages vitrine rendus dans `<main>`

- **Critère** : WCAG 1.3.1 · RGAA 12.6.
- **Constat** : l'accueil, `/association`, `/benevoles`, `/recrutement`,
  `/regles`, `/regles/[slug]`, `/rgpd`, `/rgpd/registre`, `/mentions-legales` et
  les deux pages légales du bot rendent `PublicHeader` et `PublicFooter`
  **dans** leur `<main>`. Un `<header>` ou un `<footer>` imbriqué dans `<main>`
  perd son rôle de repère (`banner`, `contentinfo`) : la navigation par repères
  ne trouve ni l'en-tête ni le pied de page, et le « contenu principal » annoncé
  commence par le menu. `/bot` et `/bot/docs` font déjà juste.
- **À faire** : sortir `PublicHeader` et `PublicFooter` de `<main>` (fragment
  autour des trois), en vérifiant l'empilement — `<main>` porte
  `position: relative; z-index: 1`, et le panneau du menu burger doit rester
  au-dessus du contenu. Le lien d'évitement saute déjà les en-têtes de tête de
  `<main>` (`lib/shared/skip-link.ts`) et restera juste après la correction.

## 16. Titres des fiches d'équipe et de joueur

- **Critère** : WCAG 2.4.2 · RGAA 8.6.
- **Constat** : `/equipes/[id]` et `/joueurs/[id]` s'intitulent « Équipes » et
  « Joueurs », hérités de l'annuaire : deux onglets ouverts sur deux fiches
  portent le même titre.
- **À faire** : un `generateMetadata` dans une mise en page de segment, sur le
  modèle de `app/(secured)/tournois/[id]/layout.tsx` — nom de l'équipe, pseudo
  du joueur, en respectant la visibilité du profil (un compte anonymisé ou
  masqué ne doit pas nommer quelqu'un dans l'onglet).
