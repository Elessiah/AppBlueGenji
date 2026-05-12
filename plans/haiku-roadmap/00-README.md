# Roadmap Haiku — Correctifs UX, Sécurité, Dette technique & Round Suisse

Cible : **Claude Haiku 4.5**. Chaque sous-fichier est **autonome** : Haiku lit ce README, puis un seul sous-fichier à la fois.

> Conventions projet et discipline anti-dette sont dans [`CLAUDE.md`](../../CLAUDE.md) (auto-chargé). Ne pas dupliquer ici.

## Comment Haiku doit travailler

1. Lire **uniquement** le sous-fichier ciblé.
2. Exécuter sans détour : pas de refactor opportuniste, pas de réécriture hors périmètre.
3. À la fin de chaque tâche : `npm run lint` + `npm test` (le cas échéant) + court résumé en français.
4. **Commit à chaque fin de tâche.** Une fois lint + tests verts, créer un commit ciblé sur les fichiers modifiés. Format : `<type>(<scope>): <résumé court>` où `<type>` ∈ `fix|feat|refactor|chore|docs` et `<scope>` reprend le numéro de tâche (ex. `feat(swiss-17): add pairing engine`). Ne jamais laisser une tâche terminée non commitée — le travail non commité peut être écrasé par une tâche parallèle.
5. Arrêter tout `npm run dev` lancé pour vérification.

## Séquence d'exécution recommandée

| Ordre | Bloc | Fichier | Raison |
|---|---|---|---|
| 1 | UX | `01-ux-cta-session-aware.md` | Quick win, débloque l'expérience utilisateur connecté |
| 2 | UX | `02-ux-nav-team-shortcut.md` | Quick win, isolé |
| 3 | Bugfix | `03-fix-avatar-display.md` | Le chemin avatar ne marche pas — bloque la feature livrée |
| 4 | UX | `04-ux-sponsors-copy.md` | Copy-only, sans risque |
| 5–9 | Sécurité | `05-…` à `09-…` | À traiter avant Round Suisse car certaines touchent `tournaments-service` |
| 10 | Dette | `10-debt-tournaments-service-split.md` | **Pré-requis du Round Suisse** : casser le god file avant d'y ajouter du code |
| 11–15 | Dette | `11-…` à `15-…` | Indépendants entre eux, peuvent s'enchaîner |
| 16 | Feature | `16-swiss-types-schema.md` | Pose les types et la migration |
| 17 | Feature | `17-swiss-pairing-engine.md` | Moteur d'appariement isolé et testable |
| 18 | Feature | `18-swiss-orchestration.md` | Intégration au service tournois (déjà splitté à l'étape 10) |
| 19 | Feature | `19-swiss-tiebreakers.md` | Buchholz et classement final |
| 20 | Feature | `20-swiss-ui-integration.md` | Pages tournoi adaptées au mode suisse |

## Dépendances dures

- `10` doit être terminé avant `18`.
- `16` avant `17`, `17` avant `18`, `18` avant `19`, `19` avant `20`.
- `07` (race condition capacité) touche `tournaments-service.ts` : à faire **avant** `10` pour limiter les rebases.

## Format des sous-fichiers

Chaque sous-fichier contient :
- **Objectif** — 1 à 2 phrases.
- **Fichiers concernés** — liste exhaustive.
- **Hors périmètre** — ce qu'il ne faut **pas** toucher.
- **Implémentation** — étapes ordonnées, snippets si utile.
- **Acceptation** — checks finaux (lint, test, manuel).
- **Discipline** — rappel anti-dette spécifique à la tâche.

## Vérification finale globale (après tous les fichiers)

1. `npm run lint` clean.
2. `npm run build` clean.
3. `npm test` clean.
4. Parcours manuel : connexion → tournoi suisse → inscription → bracket → score → classement final.
5. Aucune erreur dans la console navigateur sur `/`, `/tournois`, `/equipes`, `/joueurs`, `/profil`.
