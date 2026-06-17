# Refonte fonds « noir + éclats bleutés » & néon de navigation

Mise à jour graphique des fonds et des barres de navigation, dans la continuité du
design system « Cyber minimal ».

## Direction

- **Fond noir neutre** plutôt qu'une nuance bleue diffuse (ou des teintes chaudes/ambre,
  écartées car incohérentes avec l'identité froide de l'association).
- Le bleu glacier (`#5ac8ff` / `rgba(90, 200, 255, …)`) reste **l'accent de marque**.
- Le bleu n'apparaît plus en lavis large mais en **éclats localisés** (radial-gradients
  serrés) dans les coins / zones de tête.

## Tokens concernés (`app/globals.css`)

| Token            | Rôle                                  |
| ---------------- | ------------------------------------- |
| `--bg-0/1/2`     | Fonds legacy → noir neutre            |
| `--cyber-bg`–`3` | Fonds cyber → `#05060a` … `#161a22`   |
| `--text-*`,`--ink*` | Blancs froids (lisibilité AA)      |
| `--line-soft`, `--line-strong-cy` | Liserés bleutés froids |

- **`body`** : base quasi noire + deux éclats bleus serrés (`520×360`, `420×300`).
- **`.fabric`** : éclats bleus resserrés (au lieu des grands lavis) + grille bleutée.
- Les surfaces codées en dur (hero, cards, modales, navbar, dialogs) repassent en noir neutre.

## Néon de navigation

Le `border-bottom` plein (trait « brut » au scroll) est remplacé par un **liseré néon**
sur les deux barres :

- `components/cyber/landing/PublicHeader.module.css` — header public (landing)
- `components/arena-nav.module.css` — nav des pages sécurisées

Implémenté via un pseudo-élément `::after` :

- dégradé horizontal bleu qui s'estompe vers `transparent` aux extrémités (pas de ligne
  dure d'un bord à l'autre) ;
- double `box-shadow` bleuté (halo proche + diffusion vers le bas) qui adoucit la
  transition quand le contenu défile sous la barre ;
- intensité pilotée par `var(--glow)` pour rester cohérent avec le réglage de glow global.
