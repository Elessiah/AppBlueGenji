# Plan d'implémentation — Nettoyage cyber + refonte annuaires

Cible : **Claude Haiku 4.5**. Chaque fichier ci-dessous est autonome et peut être exécuté séquentiellement.

## Contexte

Le site BlueGenji Arena a été partiellement refait en « Cyber minimal » mais des résidus visuels (fond 3D animé avec nuances jaunes/or, navigation custom, palette « gold ») jurent avec la maquette d'origine récemment exportée. Les pages `/joueurs` et `/equipes` n'ont jamais été refaites au niveau de la maquette.

La maquette de référence se trouve dans `C:\Users\kerya\AppData\Local\Temp\design-mock\bluegenji-arena\project\` :
- `equipes.jsx` + `joueurs.jsx` + `equipes-joueurs.css` — annuaires cibles
- `tournois.jsx` + `tournois-page.css` — référence pour la nav et le ticker (déjà en partie implémentée dans `app/(secured)/tournois/`)
- `styles.css` — tokens de base (déjà absorbés dans `app/globals.css`)

## Périmètre

| Page | Action |
|---|---|
| `/` | Retirer le fond 3D + tokens jaunes (palette `gold`). Garder le contenu actuel. |
| `/association` | Idem `/`. Passer en palette `blue`. |
| `/partenaires` | Idem `/`. Passer en palette `blue`. |
| `/tournois` | Idem `/`. La page elle-même reste — elle est déjà bien alignée avec la maquette. |
| `/equipes` | Refonte totale calquée sur `equipes.jsx` (accent orange `#ff9d2e`). Implémenter les fonctionnalités manquantes (rank, V/D, form, roster avatars, jeux). |
| `/joueurs` | Refonte totale calquée sur `joueurs.jsx` (accent bleu `#5ac8ff`). Implémenter rôles, statut, tournois joués, V/D. |
| Nav `/equipes`, `/joueurs`, `/tournois`, `/profil` | Remplacer la barre actuelle par la version maquette : 3 onglets mono à gauche avec barre 2px sous l'onglet actif, logo central, `⌂ Accueil` + chip avatar à droite. |

## Séquence d'exécution

Suivre l'ordre, chaque étape s'appuie sur la précédente :

1. **`01-cleanup-yellow-3d-background.md`** — Supprime `Background3D`, palette `gold`, tokens orphelins. Sécurité : à faire en premier sinon les pages refondues hériteraient encore du fond.
2. **`02-arena-nav-mockup-style.md`** — Remplace `ArenaNav` par la version maquette (barre inférieure 2px sur onglet actif).
3. **`03-shared-annuaire-styles.md`** — Crée le module CSS partagé `app/(secured)/_shared/annuaire.module.css` repris de `equipes-joueurs.css`. Doit exister avant les pages qui le consomment.
4. **`04-equipes-redesign.md`** — Backend (extension API + types) puis page `/equipes`.
5. **`05-joueurs-redesign.md`** — Backend (extension API + types) puis page `/joueurs`.

## Conventions à respecter

- Tout le texte UI est en **français**.
- Toasts via `useToast()` (`@/components/ui/toast`) — jamais d'inline message.
- `lib/server/*` = serveur uniquement, `lib/shared/*` = libre.
- Path alias `@/*`. Helpers : `formatLocalDate`, `parseRoles`.
- Pas de tokens jaune/or après l'étape 1.
- Couleurs accent par page :
  - `/joueurs` → bleu `#5ac8ff` (rgb `90, 200, 255`)
  - `/equipes` → orange `#ff9d2e` (rgb `255, 157, 46`)
  - `/tournois` → vert `#4fe0a2` (rgb `79, 224, 162`)
- Densité : grilles 3 colonnes (équipes), 4 colonnes (joueurs), responsive aux breakpoints 1080px / 720px.

## Données dérivées vs. fictives

La maquette montre des champs absents du schéma actuel. Pour chaque champ, le plan précise :
- ✅ **Calculable** depuis les tables existantes (`bg_matches`, `bg_tournament_registrations`, etc.) → à implémenter.
- ⚠️ **Non disponible** (rang gameplay in-game, K/D, statut online) → soit omis, soit valeur figée raisonnable. Ne pas inventer de tracking.

Détail dans `04-equipes-redesign.md` et `05-joueurs-redesign.md`.

## Vérification finale

Après les 5 étapes :
1. `npm run lint` doit passer sans warning nouveau.
2. `npm run build` doit passer.
3. Lancer `npm run dev`, naviguer sur `/`, `/association`, `/tournois`, `/equipes`, `/joueurs`. Vérifier qu'il n'y a **plus aucun particule animée 3D** ni aucune trace orange/jaune sur les pages où ce n'est pas attendu (orange n'est attendu QUE comme accent sur `/equipes`).
4. La nav active doit afficher la barre 2px de la couleur du segment.
5. Les cartes équipes/joueurs doivent matcher la maquette à l'œil.
