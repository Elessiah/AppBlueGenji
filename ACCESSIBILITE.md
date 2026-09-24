# Accessibilité — tâches restantes (RGAA 4.1 / WCAG 2.2 AA)

Issu de l'audit du 2026-09-24. Déjà traité par la PR du menu d'accessibilité
(`docs/features/ACCESSIBILITY_MENU.md`) :

- notifications annoncées aux lecteurs d'écran, avec pause et fermeture ;
- bandeau défilant avec pause, copie masquée aux technologies d'assistance ;
- contraste renforcé, focus très visible, liens soulignés, police simplifiée,
  espacement du texte et réduction des animations — **en réglages activables**,
  désactivés par défaut.

Chaque tâche ci-dessous est indépendante et peut être confiée à une session
séparée. Une branche `feature/<nom>` par tâche, avec ses tests, selon le
pipeline de `CLAUDE.md`. Retirer la tâche de ce fichier dans la PR qui la règle.

---

## 1. Lien d'évitement « Aller au contenu »

- **Critère** : WCAG 2.4.1 · RGAA 12.7.
- **Constat** : aucun lien d'évitement. Le premier arrêt du clavier est le bouton
  d'accessibilité, puis la bannière de recrutement et toute la navigation.
- **À faire** : un lien visible **au focus seulement** (aucun effet visuel sinon),
  rendu dans `app/layout.tsx` juste après `<AccessibilityMenu>`, qui mène au
  `<main>` de la page. Les pages ont chacune leur `<main>` (15 fichiers) : soit
  un `id="contenu"` sur chacun, soit un gestionnaire qui cible `document.querySelector("main")`
  (lui pose `tabIndex=-1` et le focus) — préférer la seconde, qui couvre la page
  ajoutée demain.
- **Acceptation** : Tab depuis le haut de n'importe quelle page atteint le lien
  en deuxième position ; Entrée place le focus au début du contenu.

## 2. Titres de page des espaces connectés

- **Critère** : WCAG 2.4.2 · RGAA 8.6.
- **Constat** : `/tournois`, `/equipes`, `/joueurs` et `/profil` s'intitulent
  tous « BlueGenji Esport ». Ces pages sont des composants client
  (`"use client"`), elles ne peuvent pas exporter `metadata`.
- **À faire** : un `layout.tsx` serveur par segment (ou un `generateMetadata`)
  qui déclare le titre via `pageMetadata()` (`lib/shared/page-metadata.ts`).
- **Acceptation** : titres « Tournois · BlueGenji Esport », « Équipes · … »,
  « Joueurs · … », « Mon profil · … ».

## 3. Langue du contenu anglais des pages légales du bot

- **Critère** : WCAG 3.1.2 · RGAA 8.7.
- **Constat** : `components/legal/BotLegalDoc.tsx` bascule le texte en anglais
  sans changer la langue déclarée (`<html lang="fr">`).
- **À faire** : `lang={lang}` sur le conteneur du contenu affiché.

## 4. Navigation connectée : page courante et pictogrammes

- **Critère** : WCAG 1.3.1 / 4.1.2 · RGAA 12.
- **Constat** : `components/arena-nav.tsx` ne signale la page courante que par
  le style ; les pictogrammes « ⌂ » et « 🛡 » sont lus à voix haute.
- **À faire** : `aria-current="page"` sur le lien actif ; pictogrammes dans un
  `<span aria-hidden="true">`. Même revue pour `PublicHeader`.

## 5. Modales de la vitrine sans piège de focus

- **Critère** : WCAG 2.4.3 · RGAA 7.1 / 12.8.
- **Constat** : `AboutPillars`, `AboutStats`, `SponsorsGrid`, `FooterContact`
  (`components/cyber/landing/`), `BureauSection` (`app/association/`),
  `BenevolesSection` (`app/benevoles/`) gèrent Échap à la main : Tab sort de la
  modale et le focus ne revient pas au bouton d'ouverture.
- **À faire** : passer par `useDialogBehavior` (`lib/shared/hooks/useDialogBehavior.ts`),
  comme les 17 autres modales.

## 6. Lien « Voir → » de la bannière de recrutement

- **Critère** : WCAG 2.4.4 / 2.5.8 · RGAA 6.1.
- **Constat** : intitulé sans contexte, cible de 57 × 14 px
  (`components/recruitment-highlight.tsx`).
- **À faire** : nom accessible qui **commence** par « Voir » (WCAG 2.5.3) et
  nomme l'annonce ; zone cliquable d'au moins 24 px de haut.

## 7. Focus des champs hors `.field`

- **Critère** : WCAG 2.4.7 / 1.4.11 · RGAA 10.7.
- **Constat** : `outline: none` avec pour seul repère un changement de couleur
  de bordure — `modalInput` (`app/recrutement/page.module.css`,
  `app/association/page.module.css`) et `.searchbar-input` (`app/globals.css`).
  Le repère disparaît en contrastes forcés.
- **À faire** : même anneau que `.field` au focus, plus une `outline` en
  `@media (forced-colors: active)`.

## 8. Ordre des titres de `/connexion` et repères de `/association`

- **Critère** : RGAA 9.1 / 12.6.
- **Constat** : `/connexion` a un `h2` (« Avant de continuer ») avant son `h1` ;
  `/association` imbrique deux `<aside>` dans un autre repère (signalé par axe).

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

## 14. Indicateur de développement de Next

- **Constat** : en `next dev`, le bouton « N » des outils de Next occupe le coin
  bas-gauche, sous le bouton d'accessibilité, et intercepte ses clics.
- **À faire** : `devIndicators: { position: "top-right" }` dans `next.config.ts`
  (sans effet en production).
