# Design System

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

## Design System — « Cyber minimal » (Finalisé)

La refonte « Cyber minimal » est complète (Phases 1–7). Design final : noir profond teinté cool, bleu glacier `#5ac8ff`, typographie Inter / JetBrains Mono / Orbitron, glow paramétrable.

### Tokens CSS
- **Cyber tokens** : `--cyber-bg`, `--cyber-bg-1`, `--cyber-bg-2`, `--cyber-bg-3`, `--ink`, `--ink-mute`, `--ink-dim` (texte le plus atténué, ≥ 4,5:1), `--ink-faint` (ornements seulement, jamais un texte à lire), `--blue-100`–`--blue-700`, `--blue-glow`, `--amber` (existant seulement, voir plus bas), `--red-live` (+ `--amber-rgb`, `--red-live-rgb` pour les voiles translucides), `--line-soft`, `--line-strong-cy`, `--r-cy-sm/md/lg`
- **Néons froids** (2026-10) : `--cyan-400`, `--violet-300`, `--violet-400`, `--pink-400`, `--teal-400` (+ `-rgb`), `--grad-brand` (cyan → glacier → violet), `--grad-brand-soft`, `--glow-blue`, `--glow-violet` — voir § Palette « néon froid »
- **Legacy tokens** conservés pour retrocompatibilité : `--bg-0`–`--bg-2`, `--text-0`–`--text-2`, `--accent-blue/orange/green`, `--radius`, `--shadow`

### Palette « néon froid » (2026-10)

Demande : un site plus lumineux, « qui fasse rêver » côté jeu, sans dégradés de gris tristes. Contraintes de marque : base noire à reflets bleutés, **le bleu glacier `#5ac8ff` reste l'accent de marque**, **aucune teinte chaude** (ambre, orange, rouille — déjà refusées). Le rouge reste réservé à ce qui est vraiment à l'antenne (`.pill-live`).

- **Règle « jamais tout gris »** : un texte secondaire est teinté de bleu froid (composante bleue > rouge d'au moins 16), jamais un gris neutre ; une pastille, un badge ou une étiquette choisit une **variante sémantique** — le neutre seulement pour ce qui l'est vraiment.
- **Dégradé de marque** `--grad-brand` sur la chute des titres (`.text-gradient`, accent du hero), les traits d'accent (`.eyebrow::before`, `.section-head::before`, titres de section de l'accueil), et le bouton principal (glacier → cyan, texte sombre).
- **Halos** colorés (`--glow-blue`, `--glow-violet`) : `box-shadow` statiques ou au survol ; aucune `filter: blur` ni `backdrop-filter` ajoutée. Toute animation infinie lit `var(--deco-anim-state)` (`CLIENT_POWER_MODES.md`).
- **Survol** : `.hover-lift`, `CyberCard lift` et `CyberButton` grandissent à peine (`scale`, aucun décalage de mise en page ; pas de translation, qui clignote sous un pointeur posé sur le bord), neutralisé sous `prefers-reduced-motion` et `data-a11y~="motion"`.

#### Contrastes (WCAG 2.x, vérifiés par `tests/app/neon-palette.test.ts`, `lib/shared/color-contrast.ts`)

| Jeton | Valeur | sur `--cyber-bg-3` `#161a22` | sur `--cyber-bg` `#05060a` |
| --- | --- | --- | --- |
| `--ink` | `#eaf4ff` | 15,67 | 18,21 |
| `--text-1` | `#c8d8ec` | 12,02 | 13,97 |
| `--ink-mute` | `#a3bcd8` | 8,91 | 10,36 |
| `--text-2` | `#93a8c6` | 7,18 | 8,35 |
| `--ink-dim` | `#859dbb` | 6,26 | 7,27 |
| `--ink-faint` (ornement, pas un texte) | `#55698a` | 3,13 | 3,64 |
| `--cyan-400` | `#3ee6ff` | 11,59 | 13,47 |
| `--blue-500` | `#5ac8ff` | 9,25 | 10,74 |
| `--violet-300` | `#c4b5fd` | 9,44 | 10,97 |
| `--violet-400` | `#a78bfa` | 6,40 | 7,44 |
| `--pink-400` | `#f78ad8` | 7,95 | 9,24 |
| `--teal-400` | `#3ee8b0` | 11,10 | 12,90 |

Contraste renforcé (`data-a11y~="contrast"`) : `--ink-mute` `#c4d4e6` (11,54), `--ink-dim` / `--ink-faint` `#a6b9d0` (8,69), `--text-1` `#e3ecf7`, `--text-2` `#bccbdf` — toujours au-dessus des valeurs par défaut (`accessibility-styles.test.ts`).

#### Pastilles et étiquettes — variantes

`.pill` (mono, capitales) et `.cy-tag` (sans-serif, 12 px ; préfixé car `.tag` sert déjà au fil d'activité de `/bot`) nus sont bleutés. Variantes, communes aux deux (`.pill-*` / `.cy-tag-*`) et au composant `<Pill variant>` (`pillVariantClass`) :

| Variante | Couleur du texte | Sens |
| --- | --- | --- |
| `info` (et `blue`, historique) | `--blue-300` | information, en cours |
| `accent` | `--violet-300` | mise en avant, état d'un tournoi |
| `success` | `--teal-400` | réussite, validé |
| `highlight` | `--pink-400` | rehaut ponctuel |
| `neutral` | `--ink-mute` | vraiment neutre |
| `waiting` | `--violet-300` + halo qui respire | « En attente de lancement » |
| `live` | `--red-live` | **seulement** une vraie diffusion |

La pastille nue étant désormais bleutée, une pastille qui **oppose** un état à `blue` (« À jour » / « Hors ligne », phase courante / autres, « Disponible » / « Bientôt », « Inactif ») prend `neutral` pour l'état éteint — sinon les deux se confondent (`tests/app/neon-palette.test.ts`).

`--amber` n'entre dans aucune nouvelle règle ; ses usages existants (avertissements, retour en arrière, « Urgente ») migrent dans les lots suivants (`LANDING_ANIMATIONS.md` § Lots suivants).

### Défaite — teinte réservée (2026-10)

Décision du 2026-10-05 : la défaite ne partage sa couleur avec **rien d'autre**. Elle était rose (`--pink-400`), le rose du rôle DPS, du podium et des « Inscriptions ouvertes » ; elle a désormais son propre jeu de jetons, déclarés en fin de `:root` dans `app/globals.css` :

| Jeton | Valeur | Usage |
| --- | --- | --- |
| `--result-loss` (`-rgb` : `255, 31, 90`) | `#ff1f5a` | remplissages : barres de forme, liserés, halos |
| `--result-loss-ink` | `#ff5c85` (contraste renforcé : `#ff7a9b`) | **tout texte** de défaite : 5,91:1 sur `--cyber-bg-3`, 5,07:1 sur ce fond teinté à 12 % de défaite |
| `--result-loss-soft` | `--result-loss` à 14 % | fond d'une ligne perdante |
| `--result-loss-glow` | halo statique de 2 px, plus court que l’écart de 3 px entre deux barres (il ne déborde pas sur la voisine) | barres de défaite |
| `--result-loss-hatch` | hachures à 135° | barres de défaite |

**Pourquoi ce cramoisi électrique.** Dans une palette de néons froids, seule une teinte rouge se lit d'emblée comme une défaite ; mais le rouge du direct (`--red-live` `#ff4d5e`, réservé à `.pill-live`) et le saumon des erreurs (`--danger` `#ff6e82`) occupent déjà le rouge chaud et pâle. `#ff1f5a` est plus froid (teinte 344°, tirée vers le magenta) et entièrement saturé : ni orangé comme le direct, ni pastel comme le rose de rehaut ou le saumon des erreurs.

**Indice de forme.** Parce que deux rouges restent voisins pour un œil daltonien, une barre de défaite est **hachurée** et porte un halo — une barre de victoire (sarcelle) ou de nul reste pleine. Le direct, lui, est une pastille à point clignotant : les deux ne se confondent pas même en niveaux de gris.

**Où.** Barres de forme V/D (`TeamCard`, `annuaire.module.css`), chiffre « Défaites » des cartes d'équipe, de l'en-tête d'équipe (`TeamHeader`), du profil (`data-tone="loss"`) et du panneau de statistiques (`StatsPanel`), part « D » des bilans (`TeamHistory`, historique de `/joueurs/[id]`, `PlayerCard`, `HighlightStrip`) via la classe globale `.result-loss`, score du perdant d'un match tranché (`MatchRow`, classe `lostScore` ; ni forfait, qui garde son ambre, ni case vide d'une exemption), ligne `.team-line.lose`. Les bilans d'Endurance (`V / N / D` en un seul texte) restent neutres.

**Garde-fou.** `tests/app/loss-colour.test.ts` balaie `app/` et `components/` : `--result-loss*` et `.result-loss` n'apparaissent que dans une règle ou un composant de défaite, et aucune barre de défaite ne reprend le rose.

### Composants
Primitives dans `components/cyber/` :
- **CyberButton** — `variant="primary"|"ghost"`, support `asChild` (Radix Slot)
- **CyberCard** — `lift`, `ticks`, `as="div|section|article"`, style personnalisé
- **Pill** — badges inline, variantes sémantiques (§ Pastilles et étiquettes)
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
