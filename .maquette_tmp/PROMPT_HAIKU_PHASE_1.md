# Prompt de démarrage — Phase 1 (Fondations design system, additive)

> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte graphique « Cyber minimal » de BlueGenji Arena.

LIS D'ABORD :
1. CLAUDE.md (architecture, conventions, useToast, lib/server vs lib/shared)
2. .maquette_tmp/bluegenji-arena/project/styles.css (source de vérité)
3. .maquette_tmp/bluegenji-arena/project/page.css
4. .maquette_tmp/bluegenji-arena/project/app.jsx (usage réel)

CONTEXTE :
Le projet utilise déjà Rajdhani (titres) + Exo_2 (corps) dans
app/layout.tsx, avec un système de design "ds-*" (ds-hero, ds-block,
ds-chip, ds-stat, ds-title) et des palettes dynamiques (PaletteProvider).
On NE casse PAS l'existant : la Phase 1 est strictement ADDITIVE.

OBJECTIF (Phase 1 — fondations cyber-minimal en cohabitation) :

1. app/layout.tsx
   - Ajouter trois polices via next/font/google EN PLUS des existantes :
     * Inter (weights 400, 500, 600) -> variable --font-sans
     * JetBrains_Mono (weights 400, 500) -> variable --font-mono
     * Orbitron (weights 500, 600, 700) -> variable --font-display
   - Garder Rajdhani et Exo_2 inchangés.
   - Concaténer les 5 .variable sur la className du <body>.

2. app/globals.css
   - NE SUPPRIMER AUCUNE règle ni token existant (les classes ds-*,
     tournament-card, btn, card, cta-float-* doivent rester intactes).
   - AJOUTER en bas du fichier (avant la media query @media (max-width:920px))
     un bloc :

     /* ===========================================================
        CYBER-MINIMAL TOKENS (refonte additive — voir CLAUDE.md)
        =========================================================== */

   - Sous ce bloc, déclarer dans :root les tokens (les noms en --cyber-*
     ou suffixés -cy pour éviter toute collision avec les --bg-0/--bg-1/
     --line/--text-* existants) :
       --cyber-bg: #05080c;
       --cyber-bg-1: #0a0f15;
       --cyber-bg-2: #0e141c;
       --cyber-bg-3: #131a24;
       --ink: #e6f1f5;
       --ink-mute: #8ea3b0;
       --ink-dim: #53646f;
       --blue-100: #dff2ff;
       --blue-300: #8fd5ff;
       --blue-500: #5ac8ff;
       --blue-600: #2aa8e6;
       --blue-700: #1b6a8f;
       --blue-glow: rgba(90, 200, 255, 0.14);
       --amber: #f5a524;
       --red-live: #ff4d5e;
       --line-soft: rgba(180, 210, 230, 0.08);
       --line-strong-cy: rgba(180, 210, 230, 0.14);
       --r-cy-sm: 4px;
       --r-cy-md: 8px;
       --r-cy-lg: 14px;
       --density: 1;
       --glow: 1;

   - Ajouter ensuite les classes utilitaires (copier-adapter depuis
     .maquette_tmp/.../styles.css en remplaçant les --bg/--fg/--line de
     la maquette par les tokens cyber ci-dessus) :
       .eyebrow      (font-family JetBrains Mono via var(--font-mono),
                      font-size 11px, letter-spacing 0.18em, uppercase,
                      color var(--ink-mute), avec ::before trait 18px x 1px)
       .display      (font-family var(--font-sans), weight 500,
                      letter-spacing -0.02em, line-height 1.02)
       .mono         (font-family var(--font-mono))
       .logotype     (font-family var(--font-display), weight 600,
                      letter-spacing 0.08em, uppercase)
       .num          (font-family var(--font-mono),
                      font-variant-numeric tabular-nums,
                      font-feature-settings "tnum" 1)
       .fabric       (position absolute inset 0 pointer-events none, fond
                      grille 64px en --line-soft + radial glow bleu en haut
                      droit et bas gauche, multipliés par var(--glow))
       .pill         (inline-flex, padding 4px 10px, border 1px
                      var(--line-strong-cy), radius 999px, font-mono 11px
                      uppercase, color var(--ink-mute))
       .pill-live    (color var(--red-live), border rgba(255,77,94,0.35),
                      bg rgba(255,77,94,0.05) ; .dot 6px round + animation
                      pulse 1.6s infinite via @keyframes cy-pulse)
       .pill-blue    (color var(--blue-300), border rgba(90,200,255,0.3),
                      bg rgba(90,200,255,0.04))
       .card-ticks   (4 corner ticks 10x10px en --blue-500 opacity 0.6 via
                      ::before top-left et ::after bottom-right ; comme
                      dans la maquette)
       .section-head (border-top var(--line-soft), padding 24px 0 28px,
                      flex baseline space-between)

   - Le keyframe DOIT s'appeler "cy-pulse" (pas "pulse") pour éviter une
     collision potentielle avec d'autres animations.

3. NE TOUCHE À AUCUN AUTRE FICHIER.

CONTRAINTES :
- Pas de Tailwind utility classes (le projet n'utilise pas Tailwind dans
  globals.css, juste les deps).
- Pas de couleur hex en dehors du bloc :root cyber.
- Toutes les pages existantes (/, /association, /bot, /connexion,
  /(secured)/tournois, /(secured)/equipes, /(secured)/joueurs,
  /(secured)/profil) doivent rendre IDENTIQUEMENT à avant.

CRITÈRES D'ACCEPTATION :
- npm run lint  -> 0 erreur
- npm run build -> success
- npm run dev puis ouvrir http://localhost:3000 : visuellement INCHANGÉ.
- Inspecter le DOM : <body> doit avoir 5 classes (--font-title,
  --font-body, --font-sans, --font-mono, --font-display).
- Inspecter :root : les nouveaux tokens cyber doivent apparaître.

Quand tu as fini, rapporte :
- Liste des fichiers modifiés
- Sortie de npm run lint et npm run build (résumée)

Ne committe pas — je vérifie et je commite moi-même.
N'ouvre pas de prompts de confirmation pour npm — pré-autorisé.
```

---

## Après Phase 1

Si OK : commit `feat(cyber): phase 1 — design tokens & polices additifs`
puis lancer Phase 2 (composants cyber réutilisables).
