# Étape 3 — Module CSS partagé pour les annuaires

## Objectif

Les pages `/equipes` et `/joueurs` partagent une grosse partie du squelette : `.p-page`, `.p-page-head`, `.p-title`, `.p-metrics`, `.p-toolbar`, `.p-search`, `.p-chip`, `.p-sortrow`, `.p-section`, `.p-section-head`, `.t-bg-canvas`, `.t-ticker`, etc. On crée un **module CSS partagé** que les deux pages consomment, plus deux modules spécifiques pour les cartes (`tm-card`, `pl-card`) et le `highlight-strip`.

## Fichiers à créer

### 3.1 — `app/(secured)/_shared/annuaire.module.css`

Repartir de `equipes-joueurs.css` lignes 109-829. Garder TOUS les styles **non-nav** (la nav est traitée à l'étape 2). Réorganiser en CSS Modules :

Sections à porter (avec renommage CSS Module `kebab-case` → `camelCase` pour les classes consommées en `s.xxx`) :

| Source `equipes-joueurs.css` | Cible CSS Module | Lignes |
|---|---|---|
| `.p-page`, `.p-page-inner`, `.p-page-head`, `.p-title`, `.p-subtitle`, `.p-cta` | `page`, `pageInner`, `pageHead`, `title`, `subtitle`, `cta` | 110-161 |
| `.p-metrics`, `.p-metric`, `.p-metric-num`, `.p-metric-lbl`, `.p-metric-spark` | `metrics`, `metric`, `metricNum`, `metricLbl`, `metricSpark` | 164-203 |
| `.p-toolbar`, `.p-search`, `.p-search-icon`, `.p-search-kbd`, `.p-filters`, `.p-chip` | `toolbar`, `search`, `searchIcon`, `searchKbd`, `filters`, `chip`, `chipOn` | 206-267 |
| `.p-sortrow`, `.p-sortrow .sort-opts button` | `sortRow`, `sortOpts`, `sortBtn`, `sortBtnOn` | 270-289 |
| `.p-sections`, `.p-section`, `.p-section-head`, `.ix`, `.ttl`, `.accent`, `.count` | `sections`, `section`, `sectionHead`, `sectionIx`, `sectionTtl`, `sectionAccent`, `sectionCount` | 292-325 |
| `.t-ticker`, `.t-ticker-track`, `.t-ticker-item`, `.t-ticker-sep` + keyframe `tk` | `ticker`, `tickerTrack`, `tickerItem`, `tickerSep` | 781-801 |
| `.t-bg-canvas` | `bgCanvas` | 804-810 |
| Responsive (breakpoints 1080px, 720px) | adapter les sélecteurs | 813-828 |

Variables CSS à utiliser (déjà présentes dans `globals.css`) :
- `--font-sans`, `--font-mono`, `--font-display`
- `--cyber-bg`, `--cyber-bg-1`, `--cyber-bg-2`, `--cyber-bg-3`
- `--ink`, `--ink-mute`, `--ink-dim`
- `--blue-300`, `--blue-500`, `--line-soft`, `--line-strong-cy`
- `--r-cy-sm`, `--r-cy-md`, `--r-cy-lg`
- `--glow`

Variables locales **à propager via inline style** depuis le composant React (et **pas** comme classes globales) :
- `--g-rgb` : RGB de l'accent (`"90, 200, 255"` ou `"255, 157, 46"`)
- `--g-300` / `--g-500` : couleurs HEX de l'accent

Toutes les références `var(--g-rgb, 90, 200, 255)` etc. dans le CSS source sont à **conserver telles quelles** : elles fallback sur le bleu si rien n'est passé, et prennent l'orange quand `/equipes` les surcharge.

### 3.2 — `app/(secured)/_shared/BgCanvas.tsx`

Composant générique de canvas (variante du `app/(secured)/tournois/BgCanvas.tsx` existant — peut être déplacé ici pour mutualisation).

```tsx
"use client";

import { useEffect, useRef } from "react";

type BgCanvasProps = {
  /** Ex: "90, 200, 255" pour bleu, "255, 157, 46" pour orange */
  rgb?: string;
};

export function BgCanvas({ rgb = "90, 200, 255" }: BgCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf: number, w: number, h: number;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = c.width = window.innerWidth * dpr;
      h = c.height = window.innerHeight * dpr;
      c.style.width = window.innerWidth + "px";
      c.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    const N = 22;
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random() * 1200,
      y: Math.random() * 800,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.16,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const sx = w / 1200, sy = h / 800;
      ctx.fillStyle = "rgba(180,210,230,0.08)";
      for (let gx = 0; gx < 1200; gx += 60)
        for (let gy = 0; gy < 800; gy += 60)
          ctx.fillRect(gx * sx, gy * sy, 1, 1);

      nodes.forEach((n) => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > 1200) n.vx *= -1;
        if (n.y < 0 || n.y > 800) n.vy *= -1;
      });

      ctx.strokeStyle = `rgba(${rgb}, 0.10)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 180) {
            ctx.globalAlpha = (1 - d / 180) * 0.55;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x * sx, nodes[i].y * sy);
            ctx.lineTo(nodes[j].x * sx, nodes[j].y * sy);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(${rgb}, 0.5)`;
      nodes.forEach((n) => {
        ctx.beginPath();
        ctx.arc(n.x * sx, n.y * sy, 1.4, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [rgb]);

  return (
    <canvas
      ref={ref}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: "calc(0.55 * var(--glow, 1))",
      }}
      aria-hidden="true"
    />
  );
}
```

> Note : on ne déplace pas `app/(secured)/tournois/BgCanvas.tsx` (le `/tournois` actuel utilise sa propre version). On crée une version paramétrable ici. Si plus tard on veut consolider, c'est un détail d'optimisation.

### 3.3 — Vérification compilation

Pas de page modifiée à cette étape — on vérifie juste :

```bash
npm run build
```

Le build ne doit pas échouer (le module CSS et le composant sont nouveaux, ils n'affectent rien tant qu'ils ne sont pas importés).

## Critères d'acceptation

- Le fichier `app/(secured)/_shared/annuaire.module.css` existe et compile.
- Le composant `app/(secured)/_shared/BgCanvas.tsx` est typé strict, accepte un prop `rgb`.
- Aucun changement visible (rien ne consomme encore ces fichiers).

## Risques

- Conflits de `:global(...)` si on oublie de renommer une classe. Tester avec `npm run build` qui détecte les classes non utilisées dans le module.
- Variables CSS `var(--g-rgb)` non définies en haut du module → toujours définir un fallback dans `var(...)`.
