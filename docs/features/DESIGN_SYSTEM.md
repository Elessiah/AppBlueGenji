# Design System

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

## Design System — « Cyber minimal » (Finalisé)

La refonte « Cyber minimal » est complète (Phases 1–7). Design final : noir profond teinté cool, bleu glacier `#5ac8ff`, typographie Inter / JetBrains Mono / Orbitron, glow paramétrable.

### Tokens CSS
- **Cyber tokens** : `--cyber-bg`, `--cyber-bg-1`, `--cyber-bg-2`, `--cyber-bg-3`, `--ink`, `--ink-mute`, `--ink-dim`, `--blue-100`–`--blue-700`, `--blue-glow`, `--amber`, `--red-live`, `--line-soft`, `--line-strong-cy`, `--r-cy-sm/md/lg`
- **Legacy tokens** conservés pour retrocompatibilité : `--bg-0`–`--bg-2`, `--text-0`–`--text-2`, `--accent-blue/orange/green`, `--radius`, `--shadow`

### Composants
Primitives dans `components/cyber/` :
- **CyberButton** — `variant="primary"|"ghost"`, support `asChild` (Radix Slot)
- **CyberCard** — `lift`, `ticks`, `as="div|section|article"`, style personnalisé
- **Pill** — badges inline, variantes `.pill-live`, `.pill-blue`
- **CyberButton, TeamSigil, CountdownStrip, Ticker, MiniBracket** — composants spécialisés
- **ScrollArea** — `orientation="x"|"y"|"both"`, `subtle`, `fade`, `ariaLabel`
- **PublicHeader, PublicFooter** — layouts publics de landing

Classes utilitaires : `.eyebrow`, `.display`, `.mono`, `.logotype`, `.num`, `.fabric`, `.card-ticks`, `.section-head`, `.scroll-subtle`

### Typographie
- **Sans-serif** : Inter (`var(--font-sans)`)
- **Monospace** : JetBrains Mono (`var(--font-mono)`)
- **Display** : Orbitron (animations logo hero)
- Legacy : Rajdhani, Exo_2 conservés mais dépréciés
- **Police par défaut : Inter** — `body` lit `--font-sans`, plus `--font-body` (Exo 2, qui n'est plus préchargée) : un texte qui ne demandait aucune police retombait sur Exo 2, d'où des modales mi-Inter, mi-Exo 2. Une police autre qu'Inter se demande explicitement.
- **Plancher de taille : 11 px** (12 px pour du texte courant). Aucune feuille ni aucun style en ligne n'écrit moins (`font-size: 0` de masquage excepté) — balayage `tests/app/font-size-floor.test.ts` ; une taille calculée se borne par `max(11px, …)`. Exception acceptée : le texte **en unités SVG** d'un schéma mis à l'échelle (`RuleDiagram.tsx`, écarté nommément du balayage, et le graphe d'activité de `StatsPanel`) descend sous le plancher sur mobile — le monter ferait chevaucher les libellés. Monter une étiquette à largeur fixe peut exiger de resserrer son `letter-spacing` (en-tête « ÉTAT DU RELAIS » de `/bot`, séparateur de `/connexion`).
- **Hébergées dans le dépôt** (`app/fonts/`, licence OFL de chaque famille à côté), déclarées par `next/font/local` dans `app/site-fonts.ts` et posées sur `<body>` par `FONT_VARIABLES` — **jamais `next/font/google`**, qui télécharge les fichiers chez Google au démarrage de `next dev` et à la compilation : le job E2E en dépendait et échouait par intermittence sans réseau. **Un fichier par sous-ensemble de glyphes**, comme Google les servait : `subsets: ["latin"]` ne limitait que le **préchargement**, pas les fichiers — ne livrer que le latin rendait en Arial le `Ł` d'un pseudo ou un nom cyrillique, lettre par lettre. Chaque sous-ensemble est un appel `localFont` (options **littérales**, un seul `unicode-range` par appel), seul le latin est préchargé, et `fontStack` (`lib/shared/font-stack.ts`) recompose la pile : tous les sous-ensembles, **puis** le repli ajusté (calé sur Arial, qui a les glyphes latin-ext — placé avant, il les servirait). Turbopack ignore `declarations` en 15.5 : en `next dev` tous les sous-ensembles se téléchargent, la production (webpack) émet bien les `unicode-range`. Fichiers et plages viennent de Fontsource v5.3.0. Un balayage (`tests/app/self-hosted-fonts.test.ts`) refuse tout import de `next/font/google`, tout fichier cité absent ou embarqué sans être cité, et tout sous-ensemble préchargé ou sans `unicode-range`.

### Notifications & Toasts
Règle universelle : via `useToast()` (`@/components/ui/toast`), bottom-left overlay, jamais inline. `showError(message)`, `showSuccess(message)`.

### Pages Refaites
- `/` (landing) — Hero, About, Leaderboard/Calendar, Sponsors, Tournament Board, Ticker
- `/association` — CyberCard grid, stats
- `/partenaires` — Sponsors grid
- `/bot` — Hero 2-col + stats card, Features (3 cards), Commands (1 card gris)
- `/connexion` — CyberCard centré, 2 étapes (Google OAuth + Discord code)
- `/(secured)/tournois`, `/equipes`, `/joueurs`, `/profil` — refonte complète avec CyberCard, layouts sécurisés

### Classes CSS Supprimées (Phase 7)
- `.ds-hero`, `.ds-chip` (toutes variantes)
- `.cta-float`, puis `.cta-float-home` (dernier flottant « ⌂ Accueil », retiré de `/tournois/creer` : il masquait le bord des champs et invitait à partir sans enregistrer)
- **Tableaux `.table-row` sous 920 px** : repli en pile, en-tête masqué, chaque valeur qui ne se lit pas seule porte son intitulé par `data-label` (rendu en `::before`) — un nouveau tableau libelle ses cellules de valeur
- `.shimmer`, `.glow-pulse-*`, `.float-subtle`, `.tournament-card`
- Réduction : 1549 → 1283 lignes dans `app/globals.css` (-266 lignes)

### Endpoints Landing
`/api/landing/{stats,live,leaderboard,calendar,ticker}` — coexistence avec endpoints existants (pas de suppression).
